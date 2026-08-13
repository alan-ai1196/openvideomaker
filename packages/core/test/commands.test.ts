import { describe, expect, it } from 'vitest';
import { insertClipAt, rippleDeleteClip, splitClipAt } from '@openvideomaker/core';
import { mediaClip } from '@openvideomaker/core';
import { importedAsset } from '@openvideomaker/core';
import { AUDIO_MEDIA, setupSession, setupSessionWithAsset } from './helpers';

describe('rippleDeleteClip', () => {
  it('removes a clip and closes the gap', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 2_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 2_000_000, duration: 1_000_000 });
    const c = mediaClip({ trackId, assetId: asset.id, start: 5_000_000, duration: 1_000_000 });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
      tx.insertClip({ sequenceId, trackId, clip: c });
    });
    expect(rippleDeleteClip(session, sequenceId, a.id)).toBe(true);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([b.id, c.id]);
    expect(clips[0]!.start).toBe(0);
    expect(clips[1]!.start).toBe(3_000_000);
    // One atomic transaction; undo walks back one operation at a time.
    expect(session.canUndo).toBe(true);
    session.undo();
    session.undo();
    session.undo();
    const restored = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(restored).toHaveLength(3);
    expect(restored[0]!.id).toBe(a.id);
    expect(restored[2]!.start).toBe(5_000_000);
  });

  it('is a no-op for a missing clip', () => {
    const { session, sequenceId } = setupSession();
    expect(rippleDeleteClip(session, sequenceId, 'clip_missing000000000' as never)).toBe(false);
  });

  it('leaves other tracks untouched', () => {
    const { session, sequenceId, trackId, audioTrackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 2_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 2_000_000, duration: 1_000_000 });
    const music = importedAsset({ kind: 'audio', name: 'm.wav', path: 'C:/m.wav', media: AUDIO_MEDIA });
    session.transaction((tx) => {
      tx.importAsset({ asset: music });
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
      tx.insertClip({ sequenceId, trackId: audioTrackId, clip: mediaClip({ trackId: audioTrackId, assetId: music.id, start: 0, duration: 3_000_000 }) });
    });
    rippleDeleteClip(session, sequenceId, a.id);
    const audioClips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === audioTrackId)!.clips;
    expect(audioClips[0]!.start).toBe(0);
  });
});

describe('splitClipAt', () => {
  it('splits at an absolute time and returns the right clip', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 1_000_000, duration: 4_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const rightId = splitClipAt(session, sequenceId, a.id, 3_000_000);
    expect(rightId).not.toBeNull();
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips).toHaveLength(2);
    // Split generates two fresh clip ids (provenance-friendly); the original id is retired.
    expect(clips[0]!.duration).toBe(2_000_000);
    expect(clips[0]!.start).toBe(1_000_000);
    expect(clips[1]!.id).toBe(rightId);
    expect(clips[1]!.start).toBe(3_000_000);
    if (clips[1]!.kind === 'media') expect(clips[1]!.inPoint).toBe(2_000_000);
  });

  it('is a no-op outside the clip', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 1_000_000, duration: 2_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    expect(splitClipAt(session, sequenceId, a.id, 500_000)).toBeNull();
    expect(splitClipAt(session, sequenceId, a.id, 3_000_000)).toBeNull();
    expect(session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(1);
  });
});
describe('insertClipAt (insert edit)', () => {
  it('inserts into a gap untouched', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const insert = mediaClip({ trackId, assetId: asset.id, start: 3_000_000, duration: 1_000_000 });
    expect(insertClipAt(session, sequenceId, trackId, insert)).toBe(true);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([a.id, insert.id]);
  });

  it('splits an overlapped clip and shifts the right piece', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const insert = mediaClip({ trackId, assetId: asset.id, start: 4_000_000, duration: 2_000_000 });
    insertClipAt(session, sequenceId, trackId, insert);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => c.start)).toEqual([0, 4_000_000, 6_000_000]);
    expect(clips.map((c) => c.duration)).toEqual([4_000_000, 2_000_000, 6_000_000]);
    expect(clips[1]!.id).toBe(insert.id);
  });

  it('splits a fully covered clip at both boundaries', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 12_000_000, duration: 1_000_000 });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
    });
    const insert = mediaClip({ trackId, assetId: asset.id, start: 2_000_000, duration: 12_000_000 });
    insertClipAt(session, sequenceId, trackId, insert);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips).toHaveLength(4);
    expect(clips.map((c) => c.start)).toEqual([0, 2_000_000, 14_000_000, 24_000_000]);
    expect(clips[1]!.id).toBe(insert.id);
  });

  it('shifts a fully-inside clip without splitting', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 4_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 6_000_000, duration: 1_000_000 });
    const c = mediaClip({ trackId, assetId: asset.id, start: 8_000_000, duration: 1_000_000 });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
      tx.insertClip({ sequenceId, trackId, clip: c });
    });
    const insert = mediaClip({ trackId, assetId: asset.id, start: 5_000_000, duration: 2_000_000 });
    insertClipAt(session, sequenceId, trackId, insert);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([a.id, insert.id, b.id, c.id]);
    expect(clips[2]!.start).toBe(8_000_000);
    expect(clips[3]!.start).toBe(10_000_000);
    expect(clips[0]!.start).toBe(0);
    expect(clips[1]!.start).toBe(5_000_000);
  });
});

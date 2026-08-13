import { describe, expect, it } from 'vitest';
import { captionClip, OperationError } from '@openvideomaker/core';
import {
  IMAGE_MEDIA,
  importedAsset,
  makeVideoClip,
  mediaClip,
  setupSessionWithAsset,
} from './helpers';

describe('clip.insert / clip.remove', () => {
  it('inserts at an index and removes cleanly', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    const b = makeVideoClip(trackId, asset.id, 1_000_000, 1_000_000);
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
    });
    const track = session.project.sequences[sequenceId]?.tracks[0];
    expect(track?.clips.map((c) => c.id)).toEqual([a.id, b.id]);
    session.transaction((tx) => tx.removeClip({ sequenceId, clipId: a.id }));
    const trackAfter = session.project.sequences[sequenceId]?.tracks[0];
    expect(trackAfter?.clips.map((c) => c.id)).toEqual([b.id]);
  });

  it('unlinks other clips when a linked clip is removed', () => {
    const { session, sequenceId, trackId, audioTrackId, asset } = setupSessionWithAsset();
    const video = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    const audio = mediaClip({ trackId: audioTrackId, assetId: asset.id, start: 0, duration: 1_000_000, linkedClipId: video.id });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: video });
      tx.insertClip({ sequenceId, trackId: audioTrackId, clip: audio });
    });
    session.transaction((tx) => tx.removeClip({ sequenceId, clipId: video.id }));
    const audioClip = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === audioTrackId)?.clips[0];
    expect(audioClip?.linkedClipId).toBeNull();
  });

  it('rejects inserting into a missing track or asset', () => {
    const { session, sequenceId, trackId } = setupSessionWithAsset();
    expect(() =>
      session.transaction((tx) =>
        tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: tx.newAssetId(), start: 0, duration: 1000 }) }),
      ),
    ).toThrow(OperationError);
  });
});

describe('clip.trim', () => {
  it('adjusts start, duration and inPoint', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 2_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    session.transaction((tx) =>
      tx.trimClip({ sequenceId, clipId: clip.id, start: 500_000, duration: 1_000_000, inPoint: 250_000 }),
    );
    const updated = session.project.sequences[sequenceId]?.tracks[0]?.clips[0];
    expect(updated?.start).toBe(500_000);
    expect(updated?.duration).toBe(1_000_000);
    expect(updated?.kind === 'media' && updated.inPoint).toBe(250_000);
  });

  it('rejects trimming beyond the source duration', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    expect(() =>
      session.transaction((tx) => tx.trimClip({ sequenceId, clipId: clip.id, inPoint: 59_500_000, duration: 1_000_000 })),
    ).toThrow(/exceeds source/);
  });
});

describe('clip.split', () => {
  it('splits a media clip with correct inPoint continuation', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 4_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    let leftId = '';
    session.transaction((tx) => {
      leftId = tx.splitClip({ sequenceId, clipId: clip.id, at: 1_000_000, leftClipId: tx.newClipId(), rightClipId: tx.newClipId() });
    });
    const clips = session.project.sequences[sequenceId]?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]?.id).toBe(leftId);
    expect(clips[0]?.duration).toBe(1_000_000);
    expect(clips[1]?.duration).toBe(3_000_000);
    expect(clips[1]?.start).toBe(1_000_000);
    if (clips[0]?.kind === 'media' && clips[1]?.kind === 'media') {
      expect(clips[0].inPoint).toBe(0);
      expect(clips[1].inPoint).toBe(1_000_000);
    }
  });

  it('splits caption segments across the cut', () => {
    const { session, sequenceId } = setupSessionWithAsset();
    let captionTrackId = '';
    session.transaction((tx) => {
      captionTrackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'caption' });
    });
    const cap = captionClip({
      trackId: captionTrackId,
      start: 0,
      duration: 4_000_000,
      segments: [{ text: 'hello world', start: 500_000, end: 2_500_000 }],
    });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId: captionTrackId, clip: cap }));
    let leftId = '';
    session.transaction((tx) => {
      leftId = tx.splitClip({
        sequenceId,
        clipId: cap.id,
        at: 1_000_000,
        leftClipId: tx.newClipId(),
        rightClipId: tx.newClipId(),
      });
    });
    const clips = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === captionTrackId)?.clips ?? [];
    const left = clips.find((c) => c.id === leftId);
    const right = clips.find((c) => c.id !== leftId);
    if (left?.kind === 'caption' && right?.kind === 'caption') {
      expect(left.segments).toEqual([{ text: 'hello world', start: 500_000, end: 1_000_000 }]);
      expect(right.segments).toEqual([{ text: 'hello world', start: 0, end: 1_500_000 }]);
    }
  });
});

describe('clip.move', () => {
  it('moves a clip between video tracks at a new position', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    let secondTrackId = '';
    session.transaction((tx) => {
      secondTrackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video' });
    });
    const clip = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    session.transaction((tx) =>
      tx.moveClip({ sequenceId, clipId: clip.id, trackId: secondTrackId, start: 3_000_000 }),
    );
    const moved = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === secondTrackId)?.clips[0];
    expect(moved?.id).toBe(clip.id);
    expect(moved?.start).toBe(3_000_000);
  });

  it('rejects moving a video-only asset onto an audio track', () => {
    const { session, sequenceId, trackId, audioTrackId } = setupSessionWithAsset();
    const imageAsset = importedAsset({ kind: 'image', name: 'i.png', path: 'C:/i.png', media: IMAGE_MEDIA });
    session.transaction((tx) => tx.importAsset({ asset: imageAsset }));
    const clip = makeVideoClip(trackId, imageAsset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    expect(() => session.transaction((tx) => tx.moveClip({ sequenceId, clipId: clip.id, trackId: audioTrackId }))).toThrow(/audio/);
  });
});

describe('clip.speed', () => {
  it('rejects speeds that overrun the source', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 40_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    expect(() => session.transaction((tx) => tx.setClipSpeed({ sequenceId, clipId: clip.id, speed: 2 }))).toThrow(/exceeds source/);
    session.transaction((tx) => tx.setClipSpeed({ sequenceId, clipId: clip.id, speed: 1.5 }));
    expect(session.project.sequences[sequenceId]?.tracks[0]?.clips[0]?.speed).toBe(1.5);
  });
});

describe('clip.asset', () => {
  it('swaps the source asset and resets the inPoint', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    const other = importedAsset({ kind: 'video', name: 'b.mp4', path: 'C:/b.mp4', media: { durationUs: 10_000_000, hasVideo: true, hasAudio: true, width: 1280, height: 720 } });
    session.transaction((tx) => tx.importAsset({ asset: other }));
    session.transaction((tx) => tx.setClipAsset({ sequenceId, clipId: clip.id, assetId: other.id, inPoint: 500 }));
    const updated = session.project.sequences[sequenceId]?.tracks[0]?.clips[0];
    expect(updated?.kind === 'media' && updated.assetId).toBe(other.id);
    expect(updated?.kind === 'media' && updated.inPoint).toBe(500);
  });
});

describe('clip.audio', () => {
  it('rejects fades longer than the clip', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    expect(() =>
      session.transaction((tx) =>
        tx.setClipAudio({
          sequenceId,
          clipId: clip.id,
          audio: { gain: 1, muted: false, fadeInUs: 600_000, fadeOutUs: 600_000 },
        }),
      ),
    ).toThrow(/fades exceed/);
  });
});
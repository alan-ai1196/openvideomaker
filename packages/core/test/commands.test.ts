import { describe, expect, it } from 'vitest';
import { attachAsrResult, insertClipAt, planScriptPlacements, removeRangesFromClip, rippleDeleteClip, splitClipAt, splitClipAtTimes, syncTextClipsFromScript } from '@openvideomaker/core';
import { newLineId, newScriptId } from '@openvideomaker/schema';
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

describe('attachAsrResult', () => {
  const provenance = {
    capability: 'audio.asr',
    model: { id: 'hf/openai/whisper-large-v3', revision: 'main' },
    runner: { kind: 'local-python' as const, version: '0.1.0' },
    settings: { language: 'en' },
    inputs: [{ kind: 'audio' as const, role: 'source', assetId: 'asset_000000000000' }],
    generatedAt: '2026-08-14T00:00:00.000Z',
    regenerable: true,
  };

  it('creates a durable ASR transcript linked one-to-one and syncs captions', () => {
    const { session, sequenceId, asset } = setupSessionWithAsset();
    const result = attachAsrResult(session, {
      audioAssetId: asset.id,
      language: 'en',
      segments: [
        { text: 'hello', startMs: 0, endMs: 500 },
        { text: 'world', startMs: 500, endMs: 1000 },
      ],
      provenance: { ...provenance, inputs: [{ kind: 'audio', role: 'source', assetId: asset.id }] },
      sequenceId,
    });
    const transcript = session.project.transcripts[result.transcriptId];
    expect(transcript?.source.kind).toBe('asr');
    expect(transcript?.assetId).toBe(asset.id);
    expect(transcript?.segments).toHaveLength(2);
    expect(transcript?.segments[0]?.startUs).toBe(0);
    expect(transcript?.segments[1]?.endUs).toBe(1_000_000);
    expect(session.project.assetTranscripts[asset.id]).toBe(result.transcriptId);
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === result.trackId);
    expect(track?.kind).toBe('caption');
    expect(track?.clips).toHaveLength(2);
    expect(track?.clips[0]?.provenance?.capability).toBe('audio.asr');
  });

  it('replaces a previous transcript for the same asset instead of duplicating', () => {
    const { session, sequenceId, asset } = setupSessionWithAsset();
    attachAsrResult(session, {
      audioAssetId: asset.id,
      segments: [{ text: 'first', startMs: 0, endMs: 400 }],
      provenance: { ...provenance, inputs: [{ kind: 'audio', role: 'source', assetId: asset.id }] },
      sequenceId,
    });
    const second = attachAsrResult(session, {
      audioAssetId: asset.id,
      segments: [{ text: 'second', startMs: 0, endMs: 400 }],
      provenance: { ...provenance, inputs: [{ kind: 'audio', role: 'source', assetId: asset.id }] },
      sequenceId,
    });
    expect(Object.keys(session.project.transcripts)).toHaveLength(1);
    expect(session.project.assetTranscripts[asset.id]).toBe(second.transcriptId);
    const captions = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'caption');
    expect(captions?.clips).toHaveLength(1);
    const caption = captions?.clips[0];
    expect(caption?.kind === 'caption' ? (caption.segments[0]?.text ?? '') : '').toBe('second');
  });

  it('skips captions when asked and is undoable as one transaction', () => {
    const { session, sequenceId, asset } = setupSessionWithAsset();
    const result = attachAsrResult(session, {
      audioAssetId: asset.id,
      segments: [{ text: 'quiet', startMs: 0, endMs: 300 }],
      provenance: { ...provenance, inputs: [{ kind: 'audio', role: 'source', assetId: asset.id }] },
      sequenceId,
      createCaptions: false,
    });
    expect(result.trackId).toBeUndefined();
    expect(session.project.sequences[sequenceId]!.tracks.some((t) => t.kind === 'caption')).toBe(false);
    session.undo();
    expect(session.project.transcripts[result.transcriptId]).toBeUndefined();
  });
});

describe('planScriptPlacements', () => {
  it('places untimed lines sequentially with deterministic durations', () => {
    const script = {
      id: newScriptId(),
      name: 'Test',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      lines: [
        { id: newLineId(), text: 'Hello' },
        { id: newLineId(), text: 'World wide' },
      ],
    };
    const placements = planScriptPlacements(script);
    // The estimate clamps to a 1s minimum: 'Hello' would estimate 0.7s.
    expect(placements.map((p) => p.start)).toEqual([0, 1_000_000]);
    expect(placements[0]?.duration).toBe(1_000_000);
    expect(placements[1]?.duration).toBe(1_000_000);
    expect(placements[1]?.lineId).toBe(script.lines[1]?.id);
  });

  it('honors timed lines, skips empty lines, and resumes after the last timed line', () => {
    const script = {
      id: newScriptId(),
      name: 'Test',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      lines: [
        { id: newLineId(), text: 'Timed', startUs: 5_000_000, durationUs: 2_000_000 },
        { id: newLineId(), text: '   ' },
        { id: newLineId(), text: 'Follow' },
      ],
    };
    const placements = planScriptPlacements(script);
    expect(placements.map((p) => p.content)).toEqual(['Timed', 'Follow']);
    expect(placements[0]?.start).toBe(5_000_000);
    expect(placements[0]?.duration).toBe(2_000_000);
    expect(placements[1]?.start).toBe(7_000_000);
  });

  it('drives the text sync, so text and speech share one timing plan', () => {
    const { session, sequenceId } = setupSession();
    const scriptId = newScriptId();
    const firstLineId = newLineId();
    session.transaction((tx) => {
      tx.createScript({
        script: {
          id: scriptId,
          name: 'Test',
          createdAt: '2026-08-14T00:00:00.000Z',
          updatedAt: '2026-08-14T00:00:00.000Z',
          lines: [
            { id: firstLineId, text: 'A' },
            { id: newLineId(), text: 'B', startUs: 2_000_000 },
          ],
        },
      });
    });
    const sync = syncTextClipsFromScript(session, { scriptId, sequenceId });
    expect(sync?.clipCount).toBe(2);
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.name === 'Script');
    expect(track?.clips[0]?.start).toBe(0);
    expect(track?.clips[1]?.start).toBe(2_000_000);
  });
});

describe('splitClipAtTimes', () => {
  it('splits at several times in one transaction and returns the rightmost piece', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 1_000_000, duration: 9_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const result = splitClipAtTimes(session, sequenceId, a.id, [8_000_000, 3_000_000, 5_000_000]);
    expect(result).not.toBeNull();
    expect(result!.splits).toBe(3);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips).toHaveLength(4);
    expect(clips.map((c) => c.start)).toEqual([1_000_000, 3_000_000, 5_000_000, 8_000_000]);
    expect(clips.map((c) => c.duration)).toEqual([2_000_000, 2_000_000, 3_000_000, 2_000_000]);
    expect(clips[3]!.id).toBe(result!.lastPieceId);
    expect(new Set(clips.map((c) => c.id)).size).toBe(4);
  });

  it('ignores edge and out-of-range times and deduplicates', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 5_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const result = splitClipAtTimes(session, sequenceId, a.id, [0, 5_000_000, 2_000_000, 2_000_000, 9_000_000]);
    expect(result!.splits).toBe(1);
    expect(result!.lastPieceId).not.toBe(a.id);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips).toHaveLength(2);
  });

  it('is one atomic transaction: undo/redo replays deterministically', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const anchor = session.checkpoint;
    splitClipAtTimes(session, sequenceId, a.id, [2_000_000, 4_000_000, 6_000_000]);
    const after = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration }));
    expect(after).toHaveLength(4);
    while (session.checkpoint > anchor) session.undo();
    expect(session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id)).toEqual([a.id]);
    while (session.canRedo) session.redo();
    const replayed = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration }));
    expect(replayed).toEqual(after);
  });
});

describe('removeRangesFromClip', () => {
  it('removes an interior range and ripple-closes the gap for later clips', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 10_000_000, duration: 2_000_000 });
    const c = mediaClip({ trackId, assetId: asset.id, start: 12_000_000, duration: 2_000_000 });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
      tx.insertClip({ sequenceId, trackId, clip: c });
    });
    const result = removeRangesFromClip(session, sequenceId, a.id, [{ start: 2_000_000, end: 4_000_000 }]);
    expect(result).not.toBeNull();
    expect(result!.removedPieces).toBe(1);
    expect(result!.removedUs).toBe(2_000_000);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([...result!.remaining, b.id, c.id]);
    expect(clips.map((c) => c.start)).toEqual([0, 2_000_000, 8_000_000, 10_000_000]);
    expect(clips.map((c) => c.duration)).toEqual([2_000_000, 6_000_000, 2_000_000, 2_000_000]);
    expect(clips[1]!.kind === 'media' ? clips[1]!.inPoint : -1).toBe(4_000_000);
  });

  it('trims head/tail ranges and merges overlapping ones', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const result = removeRangesFromClip(session, sequenceId, a.id, [
      { start: -1_000_000, end: 1_000_000 },
      { start: 800_000, end: 1_500_000 },
      { start: 9_000_000, end: 11_000_000 },
    ]);
    expect(result!.removedUs).toBe(2_500_000);
    expect(result!.remaining).toHaveLength(1);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.start)).toEqual([0]);
    expect(clips.map((c) => c.duration)).toEqual([7_500_000]);
    expect(clips[0]!.id).toBe(result!.remaining[0]);
  });

  it('removes the whole clip when a range covers it entirely', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    const b = mediaClip({ trackId, assetId: asset.id, start: 12_000_000, duration: 1_000_000 });
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: a });
      tx.insertClip({ sequenceId, trackId, clip: b });
    });
    const result = removeRangesFromClip(session, sequenceId, a.id, [{ start: 0, end: 10_000_000 }]);
    expect(result!.removedUs).toBe(10_000_000);
    expect(result!.remaining).toEqual([]);
    const clips = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([b.id]);
    expect(clips[0]!.start).toBe(2_000_000);
  });

  it('is a no-op without matching ranges and stays undoable as one transaction', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const a = mediaClip({ trackId, assetId: asset.id, start: 0, duration: 10_000_000 });
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip: a }));
    const before = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id);
    const result = removeRangesFromClip(session, sequenceId, a.id, [{ start: 20_000_000, end: 30_000_000 }]);
    expect(result!.removedUs).toBe(0);
    expect(result!.remaining).toEqual([a.id]);
    expect(session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id)).toEqual(before);
    // Undo/replay determinism for the multi-range case.
    const anchor = session.checkpoint;
    removeRangesFromClip(session, sequenceId, a.id, [{ start: 1_000_000, end: 2_000_000 }, { start: 4_000_000, end: 6_000_000 }]);
    const after = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration }));
    while (session.checkpoint > anchor) session.undo();
    expect(session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id)).toEqual([a.id]);
    while (session.canRedo) session.redo();
    const replayed = session.project.sequences[sequenceId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration }));
    expect(replayed).toEqual(after);
  });
});


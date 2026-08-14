import { describe, expect, it } from 'vitest';
import { applyEditScript, buildShortEditScript, buildShortProposal, compileEditScript, previewEditScript } from '@openvideomaker/agent';
import { importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import type { SequenceId } from '@openvideomaker/schema';

function setupProject() {
  const session = ProjectSession.create('Shorts test');
  let sequenceId: SequenceId = '' as SequenceId;
  let trackId = '';
  const asset = importedAsset({
    kind: 'video',
    name: 'long.mp4',
    path: 'C:/long.mp4',
    media: { durationUs: 30_000_000, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: { num: 25, den: 1 } },
  });
  session.transaction((tx) => {
    sequenceId = tx.createSequence({ sequenceId: tx.newSequenceId() });
    trackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video' });
    tx.importAsset({ asset });
    tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 30_000_000 }) });
  });
  return { session, sequenceId, assetId: asset.id };
}

const ranges = [
  { startUs: 0, endUs: 1_500_000, text: 'first line', spans: [{ startUs: 100_000, endUs: 1_400_000, text: 'first line' }] },
  { startUs: 4_000_000, endUs: 6_500_000, text: 'second line', spans: [{ startUs: 4_200_000, endUs: 6_200_000, text: 'second line' }] },
];

describe('buildShortEditScript', () => {
  it('compiles to track.create + media.insert + captions with real timing', () => {
    const { session, sequenceId, assetId } = setupProject();
    const script = buildShortEditScript({ sequenceId, assetId, speed: 1, ranges });
    const compiled = compileEditScript(session.project, script);
    expect(compiled.ok).toBe(true);
    // Caption clips are inserted with the ordinary clip.insert op type.
    expect(compiled.operations.map((o) => o.type)).toEqual(['track.create', 'clip.insert', 'clip.insert', 'track.create', 'clip.insert', 'clip.insert']);
    const inserts = compiled.operations.filter((o) => o.type === 'clip.insert');
    const second = inserts[1]!;
    if (second.type !== 'clip.insert') throw new Error('expected insert');
    expect(second.params.clip.start).toBe(1_500_000);
    expect(second.params.clip.kind === 'media' ? second.params.clip.inPoint : -1).toBe(4_000_000);
  });

  it('respects the source clip speed (durations divide, source times stay)', () => {
    const { session, sequenceId, assetId } = setupProject();
    const script = buildShortEditScript({ sequenceId, assetId, speed: 2, ranges: [ranges[0]!], includeCaptions: false });
    const compiled = compileEditScript(session.project, script);
    const insert = compiled.operations.find((o) => o.type === 'clip.insert');
    if (!insert || insert.type !== 'clip.insert') throw new Error('expected insert');
    expect(insert.params.clip.duration).toBe(750_000);
    expect(insert.params.clip.kind === 'media' ? insert.params.clip.inPoint : -1).toBe(0);
  });

  it('previews cleanly and applies as one undoable transaction', () => {
    const { session, sequenceId, assetId } = setupProject();
    const proposal = buildShortProposal({ sequenceId, assetId, speed: 1, ranges, sourceClipId: 'source-clip' });
    expect(proposal.plan.goal).toContain('short');
    expect(proposal.plan.evidence).toHaveLength(2);
    const preview = previewEditScript(session.project, proposal.script);
    expect(preview.ok).toBe(true);
    expect(preview.violations).toHaveLength(0);
    const before = session.checkpoint;
    const applied = applyEditScript(session, proposal.script);
    expect(applied.ok).toBe(true);
    const sequence = session.project.sequences[sequenceId]!;
    const shortTrack = sequence.tracks.find((t) => t.name === 'Highlights');
    expect(shortTrack?.clips).toHaveLength(2);
    expect(shortTrack?.clips[0]?.start).toBe(0);
    expect(shortTrack?.clips[1]?.start).toBe(1_500_000);
    expect(shortTrack?.clips[0]?.kind === 'media' ? shortTrack.clips[0].inPoint : -1).toBe(0);
    expect(shortTrack?.clips[1]?.kind === 'media' ? shortTrack.clips[1].inPoint : -1).toBe(4_000_000);
    // Captions mirror the transcript timing relative to their clip.
    const captionTrack = sequence.tracks.find((t) => t.name === 'Short captions');
    expect(captionTrack?.clips).toHaveLength(2);
    expect(captionTrack?.clips[0]?.kind === 'caption' ? captionTrack.clips[0].segments : []).toEqual([
      { text: 'first line', start: 100_000, end: 1_400_000 },
    ]);
    // Undo all applied operations; the project is restored (re-read: the
    // session replaces the frozen project object on every change).
    while (session.checkpoint > before) session.undo();
    const restored = session.project.sequences[sequenceId]!;
    expect(restored.tracks.some((t) => t.name === 'Highlights')).toBe(false);
    expect(restored.tracks.some((t) => t.name === 'Short captions')).toBe(false);
  });

  it('omits the caption track when no range carries spans', () => {
    const { session, sequenceId, assetId } = setupProject();
    const script = buildShortEditScript({
      sequenceId,
      assetId,
      speed: 1,
      ranges: ranges.map((r) => ({ ...r, spans: [] })),
    });
    const compiled = compileEditScript(session.project, script);
    expect(compiled.operations.map((o) => o.type)).toEqual(['track.create', 'clip.insert', 'clip.insert']);
  });
});

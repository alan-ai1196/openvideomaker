import { describe, expect, it } from 'vitest';
import { importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import { COMMON_FPS, type Project, type RawOperation } from '@openvideomaker/schema';
import { applyEditScript, applyProposal, compileEditScript, createProposal, previewEditScript, suggestDemoEdits } from '@openvideomaker/agent';

function makeSession(): ProjectSession {
  const session = ProjectSession.create('Agent Test', { settings: { width: 1280, height: 720, fps: COMMON_FPS.FPS_30 } });
  const sequenceId = Object.keys(session.project.sequences)[0]!;
  const asset = importedAsset({
    kind: 'video',
    name: 'clip.mp4',
    path: 'C:/tmp/clip.mp4',
    media: { durationUs: 10_000_000, hasVideo: true, hasAudio: false, width: 1280, height: 720, fps: COMMON_FPS.FPS_30 },
  });
  session.transaction((tx) => {
    tx.importAsset({ asset });
    const video = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video', name: 'Video 1' });
    tx.insertClip({ sequenceId, trackId: video, clip: mediaClip({ trackId: video, assetId: asset.id, start: 0, duration: 4_000_000 }) });
    tx.insertClip({ sequenceId, trackId: video, clip: mediaClip({ trackId: video, assetId: asset.id, start: 4_000_000, duration: 3_000_000, inPoint: 4_000_000 }) });
  });
  return session;
}

function firstClips(project: Project): { first: string; second: string } {
  const sequence = Object.values(project.sequences)[0]!;
  const video = sequence.tracks.find((t) => t.kind === 'video')!;
  return { first: video.clips[0]!.id, second: video.clips[1]!.id };
}

describe('edit script compilation and application', () => {
  it('compiles trim/move steps into typed operations and applies them atomically', () => {
    const session = makeSession();
    const { first, second } = firstClips(session.project);
    const compiled = compileEditScript(session.project, {
      schemaVersion: 1,
      steps: [
        { op: 'clip.trim', clipId: first, duration: 3_000_000 },
        { op: 'clip.move', clipId: second, start: 3_000_000 },
      ],
    });
    expect(compiled.ok).toBe(true);
    expect(compiled.operations.map((o) => o.type)).toEqual(['clip.trim', 'clip.move']);

    const result = applyEditScript(session, compiledScript(first, second));
    expect(result.ok).toBe(true);
    const sequence = Object.values(session.project.sequences)[0]!;
    const video = sequence.tracks.find((t) => t.kind === 'video')!;
    expect(video.clips[0]!.duration).toBe(3_000_000);
    expect(video.clips[1]!.start).toBe(3_000_000);
    expect(session.log.at(-1)?.actor.kind).toBe('agent');
    // Undo is per operation: the move first, then the trim. The session
    // replaces its frozen project on undo, so re-read the track each time.
    session.undo();
    let afterFirst = Object.values(session.project.sequences)[0]!.tracks.find((t) => t.kind === 'video')!;
    expect(afterFirst.clips[1]!.start).toBe(4_000_000);
    session.undo();
    const afterSecond = Object.values(session.project.sequences)[0]!.tracks.find((t) => t.kind === 'video')!;
    expect(afterSecond.clips[0]!.duration).toBe(4_000_000);
  });

  it('supports variable bindings for created entities', () => {
    const session = makeSession();
    const sequenceId = Object.keys(session.project.sequences)[0]!;
    const result = applyEditScript(session, {
      schemaVersion: 1,
      steps: [
        { op: 'track.create', sequenceId, kind: 'caption', name: 'Captions', as: '$captions' },
        { op: 'caption.insert', trackId: '$captions', start: 0, duration: 2_000_000, segments: [{ text: 'hello', start: 0, end: 2_000_000 }] },
      ],
    });
    expect(result.ok).toBe(true);
    const sequence = Object.values(session.project.sequences)[0]!;
    const captions = sequence.tracks.find((t) => t.kind === 'caption');
    expect(captions?.name).toBe('Captions');
    expect(captions?.clips).toHaveLength(1);
    expect(captions?.clips[0]?.segments[0]?.text).toBe('hello');
  });

  it('fails atomically on unknown references without mutating the project', () => {
    const session = makeSession();
    const checkpoint = session.checkpoint;
    const result = applyEditScript(session, {
      schemaVersion: 1,
      steps: [{ op: 'clip.remove', clipId: 'clip_missing' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('clip not found');
    expect(session.checkpoint).toBe(checkpoint);
  });

  it('previews without mutating and reports invariant violations', () => {
    const session = makeSession();
    const { first, second } = firstClips(session.project);
    const checkpoint = session.checkpoint;
    const preview = previewEditScript(session.project, {
      schemaVersion: 1,
      steps: [{ op: 'clip.move', clipId: second, start: 1_000_000 }], // overlaps the first clip
    });
    expect(preview.ok).toBe(false); // the scratch apply trips the overlap invariant
    expect(preview.violations.some((v) => v.code === 'clip.overlap')).toBe(true);
    expect(session.checkpoint).toBe(checkpoint);
    void first;
  });
});

describe('proposals and the demo planner', () => {
  it('creates a reviewable proposal, applies it and marks it applied', () => {
    const session = makeSession();
    const suggestion = suggestDemoEdits(session.project)[0]!;
    expect(suggestion.plan.goal).toBe('Make the intro faster');
    const proposal = createProposal(session.project, suggestion.plan, suggestion.script);
    expect(proposal.state).toBe('proposed');
    expect(proposal.preview.ok).toBe(true);
    expect(proposal.preview.appliedTypes).toContain('clip.trim');
    const applied = applyProposal(session, proposal);
    expect(applied.ok).toBe(true);
    expect(proposal.state).toBe('applied');
    const sequence = Object.values(session.project.sequences)[0]!;
    const video = sequence.tracks.find((t) => t.kind === 'video')!;
    expect(video.clips[0]!.duration).toBe(3_000_000);
    // Applying twice is a no-op.
    const again = applyProposal(session, proposal);
    expect(again.ok).toBe(true);
  });
});

function compiledScript(first: string, second: string) {
  return {
    schemaVersion: 1 as const,
    steps: [
      { op: 'clip.trim' as const, clipId: first, duration: 3_000_000 },
      { op: 'clip.move' as const, clipId: second, start: 3_000_000 },
    ],
  };
}

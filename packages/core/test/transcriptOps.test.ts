import { describe, expect, it } from 'vitest';
import { collectViolations, importedAsset, ProjectSession, syncCaptionsFromTranscript } from '@openvideomaker/core';
import { COMMON_FPS, newSegmentId, newTranscriptId, type GenerationProvenance, type Project, type Transcript } from '@openvideomaker/schema';

function makeSession(): ProjectSession {
  const session = ProjectSession.create('Transcript Test', { settings: { width: 1280, height: 720, fps: COMMON_FPS.FPS_30 } });
  const asset = importedAsset({
    kind: 'audio',
    name: 'voice.wav',
    path: 'C:/tmp/voice.wav',
    media: { durationUs: 10_000_000, hasVideo: false, hasAudio: true, sampleRate: 24000, audioChannels: 1 },
  });
  session.transaction((tx) => {
    tx.importAsset({ asset });
  });
  return session;
}

function manualTranscript(assetId: string): Transcript {
  const now = new Date().toISOString();
  return {
    id: newTranscriptId(),
    assetId: assetId as never,
    language: 'en',
    segments: [
      { id: newSegmentId(), startUs: 0, endUs: 2_000_000, text: 'First segment' },
      { id: newSegmentId(), startUs: 2_000_000, endUs: 4_500_000, text: 'Second segment' },
      { id: newSegmentId(), startUs: 4_500_000, endUs: 6_000_000, text: 'Third segment' },
    ],
    source: { kind: 'manual' },
    createdAt: now,
    updatedAt: now,
  };
}

const asrProvenance: GenerationProvenance = {
  capability: 'audio.asr',
  model: { id: 'hf/openai/whisper-large-v3', revision: 'main' },
  runner: { kind: 'local-python', version: '0.1.0' },
  settings: { language: 'en' },
  inputs: [],
  generatedAt: '2026-08-14T00:00:00.000Z',
  regenerable: true,
};

describe('transcript operations', () => {
  it('creates a transcript linked to its asset and enforces one-per-asset', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const transcript = manualTranscript(assetId);
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    expect(session.project.transcripts[transcript.id]).toBeDefined();
    expect(session.project.assetTranscripts[assetId]).toBe(transcript.id);
    const duplicate = manualTranscript(assetId);
    expect(() =>
      session.transaction((tx) => {
        tx.createTranscript({ transcript: duplicate });
      }),
    ).toThrow(/already has a transcript/);
  });

  it('edits segments, language and removal clean up the linkage', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const transcript = manualTranscript(assetId);
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    const firstSegment = transcript.segments[0]!;
    session.transaction((tx) => {
      tx.setTranscriptSegmentText({ transcriptId: transcript.id, segmentId: firstSegment.id, text: 'Corrected text' });
      tx.setTranscriptLanguage({ transcriptId: transcript.id, language: 'zh' });
    });
    expect(session.project.transcripts[transcript.id]!.segments[0]!.text).toBe('Corrected text');
    expect(session.project.transcripts[transcript.id]!.language).toBe('zh');
    session.transaction((tx) => {
      tx.removeTranscript({ transcriptId: transcript.id });
    });
    expect(session.project.transcripts[transcript.id]).toBeUndefined();
    expect(session.project.assetTranscripts[assetId]).toBeUndefined();
  });

  it('undoes and redoes transcript operations deterministically', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const transcript = manualTranscript(assetId);
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    const before = session.checkpoint;
    session.undo();
    expect(session.project.transcripts[transcript.id]).toBeUndefined();
    session.redo();
    expect(session.project.transcripts[transcript.id]).toBeDefined();
    expect(session.checkpoint).toBe(before);
  });
});

describe('transcript invariants', () => {
  it('reports broken linkage and unordered segments', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const transcript = manualTranscript(assetId);
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    const broken = structuredClone(session.project) as Project;
    delete broken.assetTranscripts[assetId];
    const outOfOrder = structuredClone(session.project) as Project;
    const t = outOfOrder.transcripts[transcript.id]!;
    const first = t.segments[0]!;
    t.segments = [first, { ...first, id: newSegmentId(), startUs: first.startUs - 1000, endUs: first.endUs }];
    const violations = collectViolations(broken).concat(collectViolations(outOfOrder));
    expect(violations.some((v) => v.code === 'transcript.link-missing')).toBe(true);
    expect(violations.some((v) => v.code === 'transcript.segment-overlap')).toBe(true);
  });
});

describe('syncCaptionsFromTranscript', () => {
  it('rebuilds caption clips from transcript segments and is idempotent', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const transcript = manualTranscript(assetId);
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    const first = syncCaptionsFromTranscript(session, { transcriptId: transcript.id });
    expect(first).not.toBeNull();
    const sequenceId = session.project.activeSequenceId ?? Object.keys(session.project.sequences)[0]!;
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'caption');
    expect(track?.clips).toHaveLength(3);
    expect(track!.clips[0]!.segments[0]!.text).toBe('First segment');
    expect(track!.clips[0]!.duration).toBe(2_000_000);
    // Re-sync replaces instead of duplicating.
    const second = syncCaptionsFromTranscript(session, { transcriptId: transcript.id });
    expect(second?.clipCount).toBe(3);
    expect(track?.clips).toHaveLength(3);
    // One undo restores the pre-sync state (the whole sync is one transaction).
    session.undo();
    expect(track?.clips).toHaveLength(3);
  });

  it('carries ASR provenance onto caption clips and skips empty segments', () => {
    const session = makeSession();
    const assetId = Object.keys(session.project.assets)[0]!;
    const now = new Date().toISOString();
    const transcript: Transcript = {
      id: newTranscriptId(),
      assetId: assetId as never,
      language: 'en',
      segments: [
        { id: newSegmentId(), startUs: 0, endUs: 1_000_000, text: 'Hello world' },
        { id: newSegmentId(), startUs: 1_000_000, endUs: 2_000_000, text: '   ' },
      ],
      source: { kind: 'asr', provenance: asrProvenance },
      createdAt: now,
      updatedAt: now,
    };
    session.transaction((tx) => {
      tx.createTranscript({ transcript });
    });
    const sync = syncCaptionsFromTranscript(session, { transcriptId: transcript.id });
    expect(sync?.clipCount).toBe(1);
    const sequenceId = session.project.activeSequenceId ?? Object.keys(session.project.sequences)[0]!;
    const clip = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'caption')!.clips[0]!;
    expect(clip.provenance?.capability).toBe('audio.asr');
    expect(clip.provenance?.model.id).toBe('hf/openai/whisper-large-v3');
  });
});

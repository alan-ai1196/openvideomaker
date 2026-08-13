import {
  newClipId,
  newSegmentId,
  newTrackId,
  newTranscriptId,
  type AssetId,
  type Clip,
  type ClipId,
  type GenerationProvenance,
  type ScriptId,
  type SequenceId,
  type TrackId,
  type TranscriptId,
} from '@openvideomaker/schema';
import { ProjectSession } from './session.js';
import { captionClip, textClip } from './builders.js';

/**
 * Higher-level edit commands composed from the operation vocabulary.
 * They run inside one transaction, so they remain atomic, undoable and
 * replayable - commands are conveniences, never a second mutation path.
 */

/**
 * Ripple delete: remove a clip and close the gap by shifting every later
 * clip on the same track left by the removed clip's duration.
 */
export function rippleDeleteClip(session: ProjectSession, sequenceId: SequenceId, clipId: ClipId): boolean {
  const sequence = session.project.sequences[sequenceId];
  if (!sequence) return false;
  let found = false;
  let start = 0;
  let duration = 0;
  let trackId = '';
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      found = true;
      start = clip.start;
      duration = clip.duration;
      trackId = track.id;
      break;
    }
  }
  if (!found) return false;
  const laterClips = sequence.tracks
    .find((t) => t.id === trackId)!.clips
    .filter((c) => c.start >= start + duration);
  session.transaction((tx) => {
    tx.removeClip({ sequenceId, clipId });
    for (const clip of laterClips) {
      tx.moveClip({ sequenceId, clipId: clip.id, start: clip.start - duration });
    }
  });
  return true;
}

/**
 * Split a clip at an absolute timeline time. No-op when the time is not
 * strictly inside the clip. Returns the right-hand clip id, or null.
 */
export function splitClipAt(session: ProjectSession, sequenceId: SequenceId, clipId: ClipId, atUs: number): ClipId | null {
  const sequence = session.project.sequences[sequenceId];
  if (!sequence) return null;
  let clip: { start: number; duration: number } | undefined;
  for (const track of sequence.tracks) {
    const found = track.clips.find((c) => c.id === clipId);
    if (found) { clip = found; break; }
  }
  if (!clip) return null;
  const relative = atUs - clip.start;
  if (relative <= 0 || relative >= clip.duration) return null;
  const leftId = newClipId();
  const rightId = newClipId();
  session.transaction((tx) => {
    tx.splitClip({ sequenceId, clipId, at: Math.round(relative), leftClipId: leftId, rightClipId: rightId });
  });
  return rightId;
}
/**
 * Insert edit (ripple insert): split whatever contains the insertion
 * point, then shift everything from that point right by the new clip's
 * duration, so nothing is ever overwritten. Composed from clip.split /
 * clip.move / clip.insert in one atomic transaction.
 */
export function insertClipAt(session: ProjectSession, sequenceId: SequenceId, trackId: TrackId, clip: Clip): boolean {
  const sequence = session.project.sequences[sequenceId];
  const track = sequence?.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  const start = clip.start;
  const splitTargets = track.clips.filter((c) => c.start < start && start < c.start + c.duration);
  const shifts: Array<{ id: ClipId; base: number }> = track.clips
    .filter((c) => c.start >= start)
    .map((c) => ({ id: c.id, base: c.start }));
  // Every clip at/after the insertion point shifts right, so the new
  // clip slots in right after the last clip that starts earlier.
  const index = track.clips.filter((c) => c.start < start).length;

  session.transaction((tx) => {
    for (const c of splitTargets) {
      const rightId = tx.newClipId();
      tx.splitClip({ sequenceId, clipId: c.id, at: start - c.start, leftClipId: tx.newClipId(), rightClipId: rightId });
      shifts.push({ id: rightId, base: start });
    }
    for (const piece of shifts) {
      tx.moveClip({ sequenceId, clipId: piece.id, start: piece.base + clip.duration });
    }
    tx.insertClip({ sequenceId, trackId, clip, at: Math.min(index, track.clips.length) });
  });
  return true;
}

/**
 * Synchronize the caption track with a transcript: caption clips are
 * rebuilt from the transcript's segments (one clip per non-empty
 * segment). Re-running replaces the previous sync, so it is idempotent
 * and undoable as one transaction. ASR-sourced transcripts carry their
 * generation provenance onto every caption clip.
 */
export interface SyncCaptionsOptions {
  transcriptId: TranscriptId;
  sequenceId?: SequenceId;
  trackId?: TrackId;
}

export interface SyncCaptionsResult {
  trackId: TrackId;
  clipCount: number;
}

export function syncCaptionsFromTranscript(session: ProjectSession, options: SyncCaptionsOptions): SyncCaptionsResult | null {
  const transcript = session.project.transcripts[options.transcriptId];
  if (!transcript) return null;
  const sequenceId = options.sequenceId ?? session.project.activeSequenceId ?? (Object.keys(session.project.sequences)[0] as SequenceId | undefined);
  if (!sequenceId) return null;
  const sequence = session.project.sequences[sequenceId];
  if (!sequence) return null;
  // Snapshot BEFORE the transaction: ops apply only when it commits.
  const existingTrack = options.trackId
    ? sequence.tracks.find((t) => t.id === options.trackId)
    : sequence.tracks.find((t) => t.kind === 'caption' && t.name === 'Captions');
  const trackId: TrackId = existingTrack?.id ?? options.trackId ?? newTrackId();
  const createNeeded = !existingTrack;
  const clipsToRemove = existingTrack ? existingTrack.clips.map((c) => c.id) : [];
  const provenance = transcript.source.kind === 'asr' ? transcript.source.provenance : null;
  let clipCount = 0;
  session.transaction((tx) => {
    if (createNeeded) tx.createTrack({ sequenceId, trackId, kind: 'caption', name: 'Captions' });
    // Clean slate: remove previous caption clips on this track.
    for (const clipId of clipsToRemove) {
      tx.removeClip({ sequenceId, clipId });
    }
    for (const segment of transcript.segments) {
      const text = segment.text.trim();
      if (!text) continue;
      const durationUs = Math.max(segment.endUs - segment.startUs, 1000);
      const clip = captionClip({
        trackId,
        start: segment.startUs,
        duration: durationUs,
        segments: [{ text, start: 0, end: durationUs }],
      });
      clip.provenance = provenance;
      tx.insertClip({ sequenceId, trackId, clip });
      clipCount++;
    }
  });
  return { trackId, clipCount };
}

/** Deterministic spoken-duration estimate: 60ms per character + 400ms, min 1s. */
export function estimateLineDuration(text: string): number {
  return Math.max(1_000_000, text.length * 60_000 + 400_000);
}

export interface SyncScriptOptions {
  scriptId: ScriptId;
  sequenceId?: SequenceId;
  trackId?: TrackId;
}

export interface SyncScriptResult {
  trackId: TrackId;
  clipCount: number;
}

/**
 * Place script lines on a 'Script' text track: timed lines use their
 * start/duration; untimed lines follow sequentially with a
 * deterministic duration estimate. Re-running replaces the previous
 * sync in one undoable transaction.
 */
export function syncTextClipsFromScript(session: ProjectSession, options: SyncScriptOptions): SyncScriptResult | null {
  const script = session.project.scripts[options.scriptId];
  if (!script) return null;
  const sequenceId = options.sequenceId ?? session.project.activeSequenceId ?? (Object.keys(session.project.sequences)[0] as SequenceId | undefined);
  if (!sequenceId) return null;
  const sequence = session.project.sequences[sequenceId];
  if (!sequence) return null;
  // Snapshot BEFORE the transaction: ops apply only when it commits.
  const existingTrack = options.trackId
    ? sequence.tracks.find((t) => t.id === options.trackId)
    : sequence.tracks.find((t) => t.kind === 'text' && t.name === 'Script');
  const trackId: TrackId = existingTrack?.id ?? options.trackId ?? newTrackId();
  const createNeeded = !existingTrack;
  const clipsToRemove = existingTrack ? existingTrack.clips.map((c) => c.id) : [];
  const placements: Array<{ start: number; duration: number; content: string }> = [];
  let cursor = 0;
  for (const line of script.lines) {
    const content = line.text.trim();
    if (!content) continue;
    if (line.startUs !== undefined) {
      const duration = line.durationUs ?? estimateLineDuration(content);
      placements.push({ start: line.startUs, duration, content });
      cursor = line.startUs + duration;
    } else {
      const duration = estimateLineDuration(content);
      placements.push({ start: cursor, duration, content });
      cursor += duration;
    }
  }
  let clipCount = 0;
  session.transaction((tx) => {
    if (createNeeded) tx.createTrack({ sequenceId, trackId, kind: 'text', name: 'Script' });
    for (const clipId of clipsToRemove) tx.removeClip({ sequenceId, clipId });
    for (const placement of placements) {
      const clip = textClip({ trackId, start: placement.start, duration: placement.duration, content: placement.content });
      tx.insertClip({ sequenceId, trackId, clip });
      clipCount++;
    }
  });
  return { trackId, clipCount };
}

/** One time-aligned ASR segment as produced by a runner transcript output. */
export interface AsrSegmentInput {
  text: string;
  startMs: number;
  endMs: number;
}

export interface AttachAsrOptions {
  /** The media asset the transcript is linked to (one-to-one). */
  audioAssetId: AssetId;
  language?: string;
  segments: AsrSegmentInput[];
  /** Full generation provenance recorded on the transcript document. */
  provenance: GenerationProvenance;
  sequenceId?: SequenceId;
  trackId?: TrackId;
  /** Also sync caption clips from the transcript (default true). */
  createCaptions?: boolean;
}

export interface AttachAsrResult {
  transcriptId: TranscriptId;
  trackId?: TrackId;
  clipCount: number;
}

/**
 * Land an ASR result as a durable, editable transcript document linked
 * one-to-one to its media asset (replacing any previous transcript for
 * that asset), with caption clips derived through syncCaptionsFromTranscript.
 * Shared by the jobs package (node) and the Studio desktop flow (renderer),
 * so transcripts always enter projects through the same typed operations.
 */
export function attachAsrResult(session: ProjectSession, options: AttachAsrOptions): AttachAsrResult {
  const transcriptId = newTranscriptId();
  const now = new Date().toISOString();
  const segments = options.segments.map((segment) => ({
    id: newSegmentId(),
    startUs: Math.round(segment.startMs) * 1000,
    endUs: Math.round(segment.endMs) * 1000,
    text: segment.text,
  }));
  session.transaction((tx) => {
    const previous = session.project.assetTranscripts[options.audioAssetId];
    if (previous) tx.removeTranscript({ transcriptId: previous });
    tx.createTranscript({
      transcript: {
        id: transcriptId,
        assetId: options.audioAssetId,
        language: options.language,
        segments,
        source: { kind: 'asr', provenance: options.provenance },
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  let trackId: TrackId | undefined;
  let clipCount = 0;
  if (options.createCaptions !== false) {
    const sync = syncCaptionsFromTranscript(session, {
      transcriptId,
      sequenceId: options.sequenceId,
      trackId: options.trackId,
    });
    if (sync) {
      trackId = sync.trackId;
      clipCount = sync.clipCount;
    }
  }
  return { transcriptId, trackId, clipCount };
}


import type { AudioRegion, Shot } from './intelligence.js';

/**
 * Media intelligence Level 2 (pure, model-free): align durable transcript
 * segments onto shot structure, derive per-shot speech flags from audio
 * regions, and classify shots from audio + motion signals. These
 * functions are pure so the Node analysis pipeline and the Studio UI
 * share ONE implementation (type-only imports keep the browser bundle
 * free of the ffmpeg runner).
 */

export interface TranscriptSpan {
  startUs: number;
  endUs: number;
  text: string;
}

export interface ShotTranscript {
  shotIndex: number;
  startUs: number;
  endUs: number;
  /** Spoken text overlapping the shot (span texts joined with a space). */
  text: string;
  /** The transcript spans overlapping the shot, in transcript order. */
  spans: TranscriptSpan[];
}

/**
 * Map transcript segments onto shots by time overlap. A segment that
 * spans a shot boundary belongs to every shot it touches - the shot list
 * is a view over the durable transcript, never a copy of it.
 */
export function alignTranscriptToShots(shots: Shot[], spans: TranscriptSpan[]): ShotTranscript[] {
  return shots.map((shot, shotIndex) => {
    const overlapping = spans.filter(
      (span) => span.startUs < shot.endUs && span.endUs > shot.startUs && span.text.trim().length > 0,
    );
    return {
      shotIndex,
      startUs: shot.startUs,
      endUs: shot.endUs,
      text: overlapping.map((span) => span.text.trim()).join(' '),
      spans: overlapping,
    };
  });
}

/**
 * Per-shot speech flags: true when any non-silent audio region overlaps
 * the shot. Heuristic (music also counts), but model-free and cheap.
 */
export function shotsWithSpeech(shots: Shot[], audioRegions: AudioRegion[]): boolean[] {
  return shots.map((shot) =>
    audioRegions.some((region) => !region.silent && region.startUs < shot.endUs && region.endUs > shot.startUs),
  );
}

export type ShotClassKind = 'speech' | 'motion' | 'still';

export interface ClassifiedShot {
  shotIndex: number;
  startUs: number;
  endUs: number;
  text: string;
  hasSpeech: boolean;
  motionScore: number;
  kind: ShotClassKind;
}

export interface ClassifyShotsOptions {
  /** Per-shot mean inter-frame luma change (see detectShotMotion). */
  motion?: number[];
  /** Per-shot speech flags (see shotsWithSpeech). */
  speech?: boolean[];
  /** Per-shot spoken text (see alignTranscriptToShots). */
  texts?: string[];
  /** Motion score above which a silent shot counts as 'motion' (0-255). */
  motionThreshold?: number;
}

/**
 * Classify shots from cheap signals: spoken text or non-silent audio
 * makes a shot 'speech', a silent shot with enough inter-frame motion is
 * 'motion' (action/B-roll), everything else is 'still'. The thresholds
 * are documented heuristics, not model claims.
 */
export function classifyShots(shots: Shot[], options: ClassifyShotsOptions = {}): ClassifiedShot[] {
  const threshold = options.motionThreshold ?? 1.5;
  return shots.map((shot, i) => {
    const text = (options.texts?.[i] ?? '').trim();
    const hasSpeech = options.speech?.[i] ?? text.length > 0;
    const motionScore = options.motion?.[i] ?? 0;
    const kind: ShotClassKind = hasSpeech ? 'speech' : motionScore >= threshold ? 'motion' : 'still';
    return { shotIndex: i, startUs: shot.startUs, endUs: shot.endUs, text, hasSpeech, motionScore, kind };
  });
}

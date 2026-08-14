import type { ClassifiedShot } from './shotAnalysis.js';
import type { TranscriptSpan } from './shotAnalysis.js';

/**
 * Media intelligence highlight planning (pure, model-free): rank shots
 * from the Level-2 signals (speech flags, motion scores, aligned
 * transcript text) and pick a deterministic, spread-out set of ranges
 * that fits a target short duration. This is the evidence engine behind
 * the Studio's 'create a short' flow - the picked ranges become ordinary
 * clip insert operations, never locked structures.
 */

export interface HighlightRange {
  startUs: number;
  endUs: number;
  /** Source shot indexes merged into this range (shot order). */
  shotIndexes: number[];
  /** Weighted interestingness score; deterministic given the inputs. */
  score: number;
  /** Spoken text inside the range (from the aligned transcript). */
  text: string;
  /** Transcript spans inside the range, in transcript order. */
  spans: TranscriptSpan[];
}

export interface PlanHighlightsOptions {
  /** Maximum total duration of the picked ranges (default 30s). */
  targetDurationUs?: number;
  /** Maximum number of picked ranges (default 8). */
  maxRanges?: number;
  /**
   * Minimum source-time gap between picked ranges (default 1.5s). Picks
   * closer than this to an already-picked range are skipped, so the
   * short samples the source instead of replaying one continuous stretch.
   */
  minGapUs?: number;
  /** Weight for spoken shots (default 1). */
  speechWeight?: number;
  /** Weight per 10 units of mean luma motion (default 0.6). */
  motionWeight?: number;
  /** Weight per spoken word (default 0.05). */
  textWeight?: number;
  /** Include 'still' shots at a reduced weight (default false). */
  includeStills?: boolean;
  /** Per-shot transcript spans (see alignTranscriptToShots), for captions. */
  spansByShot?: Array<TranscriptSpan[] | undefined>;
}

const DEFAULT_OPTIONS = {
  targetDurationUs: 30_000_000,
  maxRanges: 8,
  minGapUs: 1_500_000,
  speechWeight: 1,
  motionWeight: 0.6,
  textWeight: 0.05,
  includeStills: false,
} as const;

function scoreShot(shot: ClassifiedShot, options: Required<PlanHighlightsOptions>): number {
  const words = shot.text.split(/\s+/).filter((w) => w.length > 0).length;
  const motionPart = Math.min(shot.motionScore, 30) / 10 * options.motionWeight;
  let score = (shot.hasSpeech ? options.speechWeight : 0) + motionPart + words * options.textWeight;
  if (shot.kind === 'still') score = options.includeStills ? score * 0.25 : 0;
  return score;
}

/** Per-shot transcript spans (aligned to the shots), for caption timing. */
export function spansForShot(shot: ClassifiedShot, spansByShot: Array<TranscriptSpan[] | undefined>, index: number): TranscriptSpan[] {
  return spansByShot[index] ?? [];
}

/**
 * Pick highlight ranges from classified shots. Deterministic: the same
 * inputs always produce the same ranges. Picks are made greedily by
 * score, spread by minGap, capped by duration and count, then returned
 * in source-time order with touching picks merged into single ranges.
 */
export function planHighlights(shots: ClassifiedShot[], options: PlanHighlightsOptions = {}): HighlightRange[] {
  const opts = { ...DEFAULT_OPTIONS, ...options } as Required<PlanHighlightsOptions>;
  if (shots.length === 0) return [];
  const scored = shots.map((shot) => ({ shot, score: scoreShot(shot, opts) }));
  const candidates = scored.filter((s) => s.score > 0);
  if (candidates.length === 0) {
    // Nothing scored: fall back to the single longest shot so the short
    // never silently fails to propose anything.
    const best = shots.reduce((a, b) => (b.endUs - b.startUs > a.endUs - a.startUs ? b : a), shots[0]!);
    return [{ startUs: best.startUs, endUs: best.endUs, shotIndexes: [best.shotIndex], score: 0, text: best.text, spans: spansForShot(best, opts.spansByShot ?? [], best.shotIndex) }];
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  let totalUs = 0;
  const gapBlocks = (shot: ClassifiedShot): boolean => {
    if (opts.minGapUs <= 0) return false;
    for (const p of picked) {
      const distance = Math.min(
        Math.abs(shot.startUs - p.shot.endUs),
        Math.abs(p.shot.startUs - shot.endUs),
      );
      if (distance < opts.minGapUs) return true;
    }
    return false;
  };
  for (const candidate of candidates) {
    if (picked.length >= opts.maxRanges) break;
    const durationUs = candidate.shot.endUs - candidate.shot.startUs;
    if (totalUs + durationUs > opts.targetDurationUs && picked.length > 0) continue;
    if (gapBlocks(candidate.shot)) continue;
    picked.push(candidate);
    totalUs += durationUs;
  }
  if (picked.length === 0) {
    // The target is shorter than every candidate: take the single best.
    const best = candidates[0]!;
    picked.push(best);
  }
  picked.sort((a, b) => a.shot.startUs - b.shot.startUs);
  // Merge touching picks (adjacent shots, gap 0) into single ranges.
  const ranges: HighlightRange[] = [];
  for (const entry of picked) {
    const shot = entry.shot;
    const spans = spansForShot(shot, opts.spansByShot ?? [], shot.shotIndex);
    const previous = ranges[ranges.length - 1];
    if (previous && shot.startUs === previous.endUs) {
      previous.endUs = shot.endUs;
      previous.shotIndexes.push(shot.shotIndex);
      previous.score = Math.max(previous.score, entry.score);
      previous.text = (previous.text + ' ' + shot.text).trim();
      previous.spans.push(...spans);
    } else {
      ranges.push({ startUs: shot.startUs, endUs: shot.endUs, shotIndexes: [shot.shotIndex], score: entry.score, text: shot.text, spans });
    }
  }
  return ranges;
}

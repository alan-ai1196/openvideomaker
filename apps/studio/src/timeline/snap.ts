import type { RationalFps } from '@openvideomaker/schema';
import { snapToFrame } from './math';

export type SnapKind = 'playhead' | 'edge';

export interface SnapResult {
  /** The frame-aligned snap position (the time to use). */
  snappedUs: number;
  /** The candidate the snap attached to (drives the guide line). */
  targetUs: number;
  kind: SnapKind;
  /** Absolute distance from the proposed time to the candidate. */
  distanceUs: number;
}

/**
 * Snap a proposed time to the nearest nearby target - the playhead or
 * another clip's edge - within the threshold. Output is frame-aligned.
 * Presentation-only: the committed edit stays an ordinary typed
 * operation, snapping never changes project semantics.
 */
export function snapTimeUs(
  proposedUs: number,
  candidates: number[],
  playheadUs: number | undefined,
  fps: RationalFps,
  thresholdUs: number,
): SnapResult | null {
  let best: SnapResult | null = null;
  const consider = (targetUs: number, kind: SnapKind) => {
    const distanceUs = Math.abs(targetUs - proposedUs);
    if (distanceUs <= thresholdUs && (!best || distanceUs < best.distanceUs)) {
      best = { snappedUs: snapToFrame(targetUs, fps), targetUs, kind, distanceUs };
    }
  };
  if (playheadUs !== undefined) consider(playheadUs, 'playhead');
  for (const targetUs of candidates) consider(targetUs, 'edge');
  return best;
}

/** Edge times (start + end) of every clip except the excluded one. */
export function collectSnapEdges(
  tracks: Array<{ clips: Array<{ id: string; start: number; duration: number }> }>,
  excludeClipId: string,
): number[] {
  const edges: number[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      edges.push(clip.start, clip.start + clip.duration);
    }
  }
  return edges;
}

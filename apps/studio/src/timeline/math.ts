import type { RationalFps } from '@openvideomaker/schema';
import { timecode } from '@openvideomaker/schema';

/** Pure timeline math: conversions between project time (µs) and pixels. */

export interface TimelineView {
  pxPerSec: number;
  /** Horizontal scroll offset in pixels. */
  scrollPx: number;
}

export function usToPx(us: number, view: TimelineView): number {
  return (us / 1_000_000) * view.pxPerSec - view.scrollPx;
}

export function pxToUs(px: number, view: TimelineView): number {
  return Math.max(0, ((px + view.scrollPx) / view.pxPerSec) * 1_000_000);
}

export function durationToPx(durationUs: number, pxPerSec: number): number {
  return (durationUs / 1_000_000) * pxPerSec;
}

/** Snap a time to the project frame grid, returning integer µs. */
export function snapToFrame(us: number, fps: RationalFps): number {
  const frameUs = (fps.den * 1_000_000) / fps.num;
  return Math.round(Math.round(us / frameUs) * frameUs);
}

/** Clamp a time to [0, sequenceDurationUs]. */
export function clampUs(us: number, sequenceDurationUs: number): number {
  return Math.max(0, Math.min(us, sequenceDurationUs));
}

/** Ruler tick step (in seconds) that keeps labels readable at a zoom. */
export function rulerStepSeconds(pxPerSec: number): number {
  const minPxBetweenLabels = 70;
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const step of candidates) {
    if (step * pxPerSec >= minPxBetweenLabels) return step;
  }
  return 600;
}

/** Compact second label for the ruler, e.g. 90 -> 1:30. */
export function rulerLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return minutes + ':' + String(seconds).padStart(2, '0');
  return String(seconds) + 's';
}

/** Format µs as HH:MM:SS:FF at the project frame rate. */
export function formatTimecode(us: number, fps: RationalFps): string {
  return timecode(us, fps);
}

import { z } from 'zod';

/**
 * Canonical time representation.
 *
 * All durations and timeline positions are integer microseconds (µs).
 * Microseconds cover a 24h+ timeline well within Number.MAX_SAFE_INTEGER and
 * keep edits frame-rate independent: the same project reinterprets cleanly at
 * 24, 25, 30, 23.976, 29.97, ... fps. Frame counts are only ever a derived
 * *display* concern computed from the project timebase (a rational fps).
 */
export const SECOND_US = 1_000_000;
export const MINUTE_US = 60 * SECOND_US;
export const HOUR_US = 60 * MINUTE_US;

export interface RationalFps {
  /** Numerator of frames-per-second (e.g. 30000 for 29.97). */
  num: number;
  /** Denominator of frames-per-second (e.g. 1001 for 29.97). */
  den: number;
}

export const RationalFpsSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const COMMON_FPS = {
  FPS_23_976: { num: 24000, den: 1001 },
  FPS_24: { num: 24, den: 1 },
  FPS_25: { num: 25, den: 1 },
  FPS_29_97: { num: 30000, den: 1001 },
  FPS_30: { num: 30, den: 1 },
  FPS_48: { num: 48, den: 1 },
  FPS_50: { num: 50, den: 1 },
  FPS_59_94: { num: 60000, den: 1001 },
  FPS_60: { num: 60, den: 1 },
} as const satisfies Record<string, RationalFps>;

/** Convert a frame count at the given timebase to microseconds. */
export function framesToUs(frames: number, fps: RationalFps): number {
  return Math.round((frames * fps.den * SECOND_US) / fps.num);
}

/** Convert microseconds to a (floored) frame count at the given timebase. */
export function usToFrames(us: number, fps: RationalFps): number {
  return Math.floor((us * fps.num) / (fps.den * SECOND_US));
}

export function secondsToUs(seconds: number): number {
  return Math.round(seconds * SECOND_US);
}

export function usToSeconds(us: number): number {
  return us / SECOND_US;
}

/** Rounded display frame rate (e.g. 29.97 for 30000/1001). */
export function displayFrameRate(fps: RationalFps): number {
  return Math.round((fps.num / fps.den) * 1000) / 1000;
}

/**
 * Non-drop-frame timecode HH:MM:SS:FF at the given timebase.
 * (Drop-frame 29.97 timecode is a display convention handled at the UI layer;
 * canonical time stays µs.)
 */
export function timecode(us: number, fps: RationalFps): string {
  const rate = Math.max(1, Math.round(fps.num / fps.den));
  const totalFrames = usToFrames(us, fps);
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds) + ':' + pad(frames);
}

/** Half-open time range [start, end) in microseconds. */
export interface TimeRange {
  start: number;
  end: number;
}

export const TimeRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export function rangeDuration(range: TimeRange): number {
  return range.end - range.start;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function rangeContains(outer: TimeRange, inner: TimeRange): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

export function rangesUnion(a: TimeRange, b: TimeRange): TimeRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

export function clampToRange(value: number, range: TimeRange): number {
  return Math.min(Math.max(value, range.start), range.end);
}

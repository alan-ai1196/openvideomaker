import { describe, expect, it } from 'vitest';
import {
  COMMON_FPS,
  framesToUs,
  rangeContains,
  rangeDuration,
  rangesOverlap,
  rangesUnion,
  secondsToUs,
  timecode,
  usToFrames,
  usToSeconds,
} from '@openvideomaker/schema';

describe('time helpers', () => {
  it('round-trips frames at integer fps', () => {
    expect(framesToUs(150, COMMON_FPS.FPS_30)).toBe(5 * 1_000_000);
    expect(usToFrames(5_000_000, COMMON_FPS.FPS_30)).toBe(150);
    expect(usToFrames(framesToUs(999, COMMON_FPS.FPS_24), COMMON_FPS.FPS_24)).toBe(999);
  });

  it('handles 29.97 timebase without drift', () => {
    // 100 frames at 29.97 ≈ 3.3367 s
    const us = framesToUs(100, COMMON_FPS.FPS_29_97);
    expect(us).toBe(Math.round((100 * 1001 * 1_000_000) / 30000));
    expect(usToFrames(us, COMMON_FPS.FPS_29_97)).toBe(100);
  });

  it('converts seconds', () => {
    expect(secondsToUs(1.5)).toBe(1_500_000);
    expect(usToSeconds(2_000_000)).toBe(2);
  });

  it('formats non-drop timecode', () => {
    // 3723.4s at 30 fps = 111702 frames = 01:02:03:12
    expect(timecode(secondsToUs(3723.4), COMMON_FPS.FPS_30)).toBe('01:02:03:12');
    expect(timecode(0, COMMON_FPS.FPS_30)).toBe('00:00:00:00');
  });
});

describe('TimeRange helpers', () => {
  it('computes duration and overlap', () => {
    expect(rangeDuration({ start: 100, end: 200 })).toBe(100);
    expect(rangesOverlap({ start: 0, end: 100 }, { start: 100, end: 200 })).toBe(false);
    expect(rangesOverlap({ start: 0, end: 101 }, { start: 100, end: 200 })).toBe(true);
    expect(rangeContains({ start: 0, end: 200 }, { start: 50, end: 150 })).toBe(true);
    expect(rangeContains({ start: 0, end: 200 }, { start: 50, end: 250 })).toBe(false);
  });

  it('unions ranges', () => {
    expect(rangesUnion({ start: 0, end: 100 }, { start: 50, end: 200 })).toEqual({ start: 0, end: 200 });
  });
});
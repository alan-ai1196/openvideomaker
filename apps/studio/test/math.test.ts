import { describe, expect, it } from 'vitest';
import { COMMON_FPS } from '@openvideomaker/schema';
import { durationToPx, formatTimecode, pxToUs, rulerLabel, rulerStepSeconds, snapToFrame, usToPx } from '../src/timeline/math';

describe('timeline math', () => {
  it('converts between µs and pixels', () => {
    const view = { pxPerSec: 50, scrollPx: 0 };
    expect(usToPx(2_000_000, view)).toBe(100);
    expect(pxToUs(100, view)).toBe(2_000_000);
    expect(durationToPx(1_500_000, 50)).toBe(75);
  });

  it('accounts for scroll offset', () => {
    const view = { pxPerSec: 50, scrollPx: 200 };
    expect(usToPx(5_000_000, view)).toBe(50);
    expect(pxToUs(50, view)).toBe(5_000_000);
  });

  it('snaps to the frame grid', () => {
    const fps = COMMON_FPS.FPS_30;
    expect(snapToFrame(1_000_000, fps)).toBe(1_000_000);
    expect(snapToFrame(1_010_000, fps)).toBe(1_000_000);
    expect(snapToFrame(1_020_000, fps)).toBe(1_033_333);
    expect(Number.isInteger(snapToFrame(999_999, fps))).toBe(true);
  });

  it('picks readable ruler steps', () => {
    expect(rulerStepSeconds(50)).toBe(2);
    expect(rulerStepSeconds(150)).toBe(0.5);
    expect(rulerStepSeconds(8)).toBe(10);
  });

  it('formats ruler labels', () => {
    expect(rulerLabel(0)).toBe('0s');
    expect(rulerLabel(45)).toBe('45s');
    expect(rulerLabel(90)).toBe('1:30');
    expect(rulerLabel(600)).toBe('10:00');
  });

  it('formats timecode at the project frame rate', () => {
    expect(formatTimecode(3_000_000, COMMON_FPS.FPS_30)).toBe('00:00:03:00');
  });
});

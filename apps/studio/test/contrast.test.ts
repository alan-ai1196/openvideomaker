import { describe, expect, it } from 'vitest';

/** WCAG 2.x relative luminance + contrast ratio for small-text AA checks. */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const PAIRS: Array<[string, string, string]> = [
  // [theme, foreground, background] - every pair must reach AA (4.5) for small text
  ['dark', '#e8eaee', '#1a1d23'],
  ['dark', '#a6adba', '#1a1d23'],
  ['dark', '#7d8494', '#1a1d23'],
  ['dark', '#7d8494', '#141519'],
  ['dark', '#e86a62', '#21252d'],
  ['dark', '#4f9cf9', '#1a1d23'],
  ['dark', '#0d1420', '#4f9cf9'],
  ['light', '#1b1e24', '#ffffff'],
  ['light', '#4d5563', '#ffffff'],
  ['light', '#6d7482', '#ffffff'],
  ['light', '#d23d36', '#ffffff'],
  ['light', '#2f6fe0', '#ffffff'],
];

describe('design token contrast (WCAG AA)', () => {
  it('every text/background pair reaches 4.5:1', () => {
    for (const [theme, fg, bg] of PAIRS) {
      expect(contrast(fg, bg), theme + ' ' + fg + ' on ' + bg).toBeGreaterThanOrEqual(4.5);
    }
  });
});

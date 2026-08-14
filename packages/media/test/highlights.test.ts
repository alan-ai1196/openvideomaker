import { describe, expect, it } from 'vitest';
import { planHighlights } from '@openvideomaker/media';
import type { ClassifiedShot } from '@openvideomaker/media/shot-analysis';

function shot(index: number, startUs: number, endUs: number, partial: Partial<ClassifiedShot> = {}): ClassifiedShot {
  return { shotIndex: index, startUs, endUs, text: '', hasSpeech: false, motionScore: 0, kind: 'still', ...partial };
}

const threeSpeech = [
  shot(0, 0, 1_500_000, { hasSpeech: true, kind: 'speech' }),
  shot(1, 1_900_000, 3_400_000, { hasSpeech: true, kind: 'speech' }),
  shot(2, 3_800_000, 4_900_000, { hasSpeech: true, kind: 'speech' }),
];

describe('planHighlights', () => {
  it('picks every speech shot when spread is off, in time order', () => {
    const ranges = planHighlights(threeSpeech, { minGapUs: 0 });
    expect(ranges).toHaveLength(3);
    expect(ranges.map((r) => [r.startUs, r.endUs])).toEqual([
      [0, 1_500_000],
      [1_900_000, 3_400_000],
      [3_800_000, 4_900_000],
    ]);
  });

  it('spreads picks by the minimum gap (default 1.5s)', () => {
    const ranges = planHighlights(threeSpeech);
    expect(ranges.map((r) => [r.startUs, r.endUs])).toEqual([
      [0, 1_500_000],
      [3_800_000, 4_900_000],
    ]);
  });

  it('caps the total picked duration', () => {
    const ranges = planHighlights(threeSpeech, { targetDurationUs: 3_000_000, minGapUs: 0 });
    const total = ranges.reduce((sum, r) => sum + (r.endUs - r.startUs), 0);
    expect(total).toBe(3_000_000);
  });

  it('is deterministic across repeated calls', () => {
    expect(planHighlights(threeSpeech)).toEqual(planHighlights(threeSpeech));
  });

  it('ranks spoken and moving shots above silent stills', () => {
    const mixed = [
      shot(0, 0, 1_000_000),
      shot(1, 1_000_000, 2_000_000, { hasSpeech: true, kind: 'speech' }),
      shot(2, 2_000_000, 3_000_000, { motionScore: 10, kind: 'motion' }),
      shot(3, 3_000_000, 4_000_000, { hasSpeech: true, kind: 'speech' }),
    ];
    const ranges = planHighlights(mixed, { targetDurationUs: 3_000_000, minGapUs: 0 });
    expect(ranges.some((r) => r.shotIndexes.includes(0))).toBe(false);
    expect(ranges.some((r) => r.shotIndexes.includes(1))).toBe(true);
    expect(ranges.some((r) => r.shotIndexes.includes(2))).toBe(true);
  });

  it('merges touching picks and carries transcript spans', () => {
    const ranges = planHighlights(
      [
        shot(0, 0, 1_000_000, { hasSpeech: true, kind: 'speech', text: 'one' }),
        shot(1, 1_000_000, 2_000_000, { hasSpeech: true, kind: 'speech', text: 'two' }),
      ],
      {
        minGapUs: 0,
        spansByShot: [
          [{ startUs: 100_000, endUs: 900_000, text: 'one' }],
          [{ startUs: 1_200_000, endUs: 1_900_000, text: 'two' }],
        ],
      },
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.startUs).toBe(0);
    expect(ranges[0]!.endUs).toBe(2_000_000);
    expect(ranges[0]!.spans.map((s) => s.text)).toEqual(['one', 'two']);
  });

  it('falls back to the longest shot when nothing scores', () => {
    const ranges = planHighlights([shot(0, 0, 500_000), shot(1, 600_000, 1_800_000)]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.startUs).toBe(600_000);
    expect(ranges[0]!.endUs).toBe(1_800_000);
  });
});

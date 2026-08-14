import { describe, expect, it } from 'vitest';
import { alignTranscriptToShots, classifyShots, shotsWithSpeech } from '@openvideomaker/media';
import type { AudioRegion, Shot } from '@openvideomaker/media';

const shots: Shot[] = [
  { startUs: 0, endUs: 1_000_000 },
  { startUs: 1_000_000, endUs: 2_500_000 },
  { startUs: 2_500_000, endUs: 4_000_000 },
];

describe('alignTranscriptToShots', () => {
  it('maps segments onto shots by overlap, sharing boundary-spanning text', () => {
    const aligned = alignTranscriptToShots(shots, [
      { startUs: 200_000, endUs: 1_300_000, text: 'hello' },
      { startUs: 1_400_000, endUs: 2_800_000, text: 'world' },
      { startUs: 2_900_000, endUs: 3_000_000, text: '   ' },
    ]);
    expect(aligned.map((s) => s.text)).toEqual(['hello', 'hello world', 'world']);
    expect(aligned[0]!.spans).toHaveLength(1);
    expect(aligned[1]!.spans).toHaveLength(2);
    expect(aligned[2]!.spans).toHaveLength(1);
  });

  it('returns empty text for shots with no overlapping speech', () => {
    const aligned = alignTranscriptToShots(shots, [{ startUs: 3_900_000, endUs: 4_000_000, text: 'tail' }]);
    expect(aligned[0]!.text).toBe('');
    expect(aligned[2]!.text).toBe('tail');
  });
});

describe('shotsWithSpeech', () => {
  it('flags shots overlapped by non-silent audio only', () => {
    const regions: AudioRegion[] = [
      { startUs: 300_000, endUs: 900_000, silent: false },
      { startUs: 2_000_000, endUs: 2_400_000, silent: true },
      { startUs: 2_600_000, endUs: 3_500_000, silent: false },
    ];
    expect(shotsWithSpeech(shots, regions)).toEqual([true, false, true]);
  });
});

describe('classifyShots', () => {
  it('labels speech first, then motion, then still', () => {
    const classified = classifyShots(shots, {
      texts: ['', 'spoken words here', ''],
      motion: [0.1, 4.2, 6.0],
      speech: [false, true, false],
    });
    expect(classified.map((c) => c.kind)).toEqual(['still', 'speech', 'motion']);
    expect(classified[1]!.hasSpeech).toBe(true);
    expect(classified[2]!.motionScore).toBe(6.0);
  });

  it('derives speech from text when flags are absent', () => {
    const classified = classifyShots(shots, { texts: ['', 'hello', ''] });
    expect(classified.map((c) => c.kind)).toEqual(['still', 'speech', 'still']);
  });

  it('respects a custom motion threshold', () => {
    const classified = classifyShots(shots, { motion: [0.4, 0.4, 0.4], motionThreshold: 0.3 });
    expect(classified.map((c) => c.kind)).toEqual(['motion', 'motion', 'motion']);
  });
});

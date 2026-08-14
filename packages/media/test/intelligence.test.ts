import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeMedia, detectShots, detectAudioRegions, runTool } from '@openvideomaker/media';

const dir = mkdtempSync(join(tmpdir(), 'ovm-intel-'));
const videoPath = join(dir, 'scenes.mp4');
const audioPath = join(dir, 'speech-silence.wav');
const VIDEO_DURATION_US = 3_000_000;

beforeAll(async () => {
  // Two distinct scenes: red for 1.5s, blue for 1.5s.
  const made = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1.5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[outv]',
    '-map', '[outv]', '-c:v', 'libx264', '-r', '25', videoPath,
  ]);
  if (made.code !== 0) throw new Error('video fixture failed: ' + made.stderr);
  // 1s tone, 0.5s silence, 0.5s tone.
  const audioMade = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono:d=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[outa]',
    '-map', '[outa]', audioPath,
  ]);
  if (audioMade.code !== 0) throw new Error('audio fixture failed: ' + audioMade.stderr);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('media intelligence level 1', () => {
  it('detects the two-scene cut near 1.5s', async () => {
    const shots = await detectShots(videoPath, { durationUs: VIDEO_DURATION_US });
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const boundary = shots[0]?.endUs ?? 0;
    expect(Math.abs(boundary - 1_500_000)).toBeLessThan(300_000);
    expect(shots[shots.length - 1]!.endUs).toBeGreaterThan(2_500_000);
  });

  it('finds the silence gap between the tones', async () => {
    const regions = await detectAudioRegions(audioPath, { durationUs: 2_000_000 });
    const silent = regions.filter((r) => r.silent);
    expect(silent.length).toBeGreaterThanOrEqual(1);
    const gap = silent[0]!;
    expect(Math.abs(gap.startUs - 1_000_000)).toBeLessThan(200_000);
    expect(gap.endUs - gap.startUs).toBeGreaterThan(200_000);
    // Non-silent regions fill the rest.
    expect(regions.some((r) => !r.silent)).toBe(true);
  });

  it('composes keyframe points at shot midpoints', async () => {
    const analysis = await analyzeMedia(videoPath, { durationUs: VIDEO_DURATION_US });
    expect(analysis.keyframeAtUs).toHaveLength(analysis.shots.length);
    expect(analysis.durationUs).toBeGreaterThan(2_500_000);
    for (const point of analysis.keyframeAtUs) expect(point).toBeGreaterThan(0);
  }, 120_000);
});
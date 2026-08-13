import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { extractThumbnails, generateWaveformPeaks, probeMediaPath, runTool } from '@openvideomaker/media';

const dir = mkdtempSync(join(tmpdir(), 'ovm-media-'));
const videoPath = join(dir, 'sample.mp4');
const audioPath = join(dir, 'sample.wav');

beforeAll(async () => {
  // Generate real test media with ffmpeg (testsrc2 + sine audio, and a pure tone wav).
  const video = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac',
    '-shortest',
    '-t', '4',
    '-y', videoPath,
  ], { timeoutMs: 120_000 });
  if (video.code !== 0) throw new Error('failed to generate sample video: ' + video.stderr);

  const audio = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
    '-c:a', 'pcm_s16le',
    '-y', audioPath,
  ], { timeoutMs: 120_000 });
  if (audio.code !== 0) throw new Error('failed to generate sample audio: ' + audio.stderr);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('probeMediaPath', () => {
  it('probes a generated video with exact dimensions and rational fps', async () => {
    const { media, kind } = await probeMediaPath(videoPath);
    expect(kind).toBe('video');
    expect(media.hasVideo).toBe(true);
    expect(media.hasAudio).toBe(true);
    expect(media.width).toBe(640);
    expect(media.height).toBe(360);
    expect(media.fps).toEqual({ num: 30, den: 1 });
    expect(media.durationUs).toBeGreaterThan(3_900_000);
    expect(media.durationUs).toBeLessThan(4_100_000);
    expect(media.audioChannels).toBeGreaterThanOrEqual(1);
  });

  it('probes a pure audio file', async () => {
    const { media, kind } = await probeMediaPath(audioPath);
    expect(kind).toBe('audio');
    expect(media.hasAudio).toBe(true);
    expect(media.hasVideo).toBe(false);
    expect(media.sampleRate).toBe(44100);
    expect(media.durationUs).toBeGreaterThan(2_900_000);
  });

  it('fails loudly for a missing file', async () => {
    await expect(probeMediaPath(join(dir, 'nope.mp4'))).rejects.toThrow();
  });
});

describe('extractThumbnails', () => {
  it('extracts an evenly spaced jpg filmstrip', async () => {
    const cacheDir = join(dir, 'thumbs');
    const thumbs = await extractThumbnails(videoPath, 4_000_000, { cacheDir, width: 160, count: 6 });
    expect(thumbs).toHaveLength(6);
    for (const dataUrl of thumbs) {
      expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(dataUrl.length).toBeGreaterThan(500);
    }
  });
});

describe('generateWaveformPeaks', () => {
  it('produces normalized peaks across the full duration', async () => {
    const { peaks, peaksPerSecond, durationUs } = await generateWaveformPeaks(videoPath, 4_000_000, { tempDir: dir, peaksPerSecond: 20 });
    expect(peaksPerSecond).toBe(20);
    expect(durationUs).toBe(4_000_000);
    expect(peaks.length).toBe(80);
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...peaks)).toBeGreaterThan(0.05);
  });

  it('works for pure audio too', async () => {
    const { peaks } = await generateWaveformPeaks(audioPath, 3_000_000, { tempDir: dir, peaksPerSecond: 10 });
    expect(peaks.length).toBe(30);
    expect(Math.max(...peaks)).toBeGreaterThan(0.05);
  });
});

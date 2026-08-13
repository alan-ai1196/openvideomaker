import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runTool } from './run.js';
import { MediaError, type Waveform, type WaveformOptions } from './types.js';

/**
 * Generate waveform peaks for an audio-bearing file: decode to mono s16le
 * PCM via ffmpeg (temp file), then bucket samples into normalized peaks.
 */
export async function generateWaveformPeaks(
  path: string,
  durationUs: number,
  options: WaveformOptions & { tempDir: string; ffmpeg?: string; timeoutMs?: number },
): Promise<Waveform> {
  const peaksPerSecond = options.peaksPerSecond ?? 24;
  const pcmFile = join(options.tempDir, 'ovm-' + Date.now() + '-' + basename(path).replace(/[^\w.-]+/g, '_') + '.pcm');
  const binary = options.ffmpeg ?? process.env.OVM_FFMPEG ?? 'ffmpeg';
  const result = await runTool(binary, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', path,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 's16le',
    '-y',
    pcmFile,
  ], { timeoutMs: options.timeoutMs ?? 120_000, maxOutputBytes: 1024 * 1024 });
  if (result.code !== 0) {
    throw new MediaError('probe.failed', 'waveform extraction failed: ' + result.stderr.trim().split('\n')[0], { command: binary });
  }
  if (!existsSync(pcmFile)) {
    throw new MediaError('io.failed', 'waveform pcm output missing', { command: binary });
  }
  const pcm = readFileSync(pcmFile);
  const sampleCount = Math.floor(pcm.length / 2);
  const totalPeaks = Math.max(1, Math.round((durationUs / 1_000_000) * peaksPerSecond));
  const samplesPerPeak = Math.max(1, Math.floor(sampleCount / totalPeaks));
  const peaks: number[] = [];
  for (let i = 0; i < totalPeaks; i += 1) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, sampleCount);
    let max = 0;
    for (let j = start; j < end; j += 1) {
      const v = Math.abs(pcm.readInt16LE(j * 2)) / 32768;
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return { peaks, peaksPerSecond, durationUs };
}
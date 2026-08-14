import { runTool } from './run.js';

/**
 * Media intelligence Level 1: deterministic, ffmpeg-derived structure -
 * shot boundaries, per-shot keyframe points, and audio silence regions.
 * This is the foundation of the media understanding hierarchy: cheap,
 * capability-free signals derived on import/indexing, before any model
 * ever runs.
 */
export interface Shot {
  startUs: number;
  endUs: number;
}

export interface AudioRegion {
  startUs: number;
  endUs: number;
  silent: boolean;
}

export interface MediaAnalysis {
  durationUs: number;
  shots: Shot[];
  /** Mid-shot points, useful for filmstrip/keyframe extraction. */
  keyframeAtUs: number[];
  audioRegions: AudioRegion[];
}

const us = (seconds: number): number => Math.round(seconds * 1_000_000);

export interface DetectShotsOptions {
  /** Scene-change sensitivity (ffmpeg select=gt(scene,..)); default 0.3. */
  threshold?: number;
  durationUs?: number;
}

/** Shot boundaries via ffmpeg's scene-change filter (showinfo timestamps). */
export async function detectShots(path: string, options: DetectShotsOptions = {}): Promise<Shot[]> {
  const threshold = options.threshold ?? 0.3;
  const result = await runTool('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', path,
    '-vf', "select='gt(scene," + threshold + ")',showinfo",
    '-an', '-f', 'null', '-',
  ], { timeoutMs: 600_000 });
  const bounds: number[] = [0];
  for (const line of (result.stderr ?? '').split(/[\r\n]+/)) {
    const match = /pts_time:([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (match) bounds.push(Number(match[1]));
  }
  bounds.push((options.durationUs ?? 0) / 1_000_000);
  const sorted = [...new Set(bounds)].sort((a, b) => a - b);
  const shots: Shot[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i + 1]! - sorted[i]! < 0.2) continue; // noise
    shots.push({ startUs: us(sorted[i]!), endUs: us(sorted[i + 1]!) });
  }
  return shots;
}

export interface DetectAudioOptions {
  /** silencedetect noise floor in dB (default -30). */
  noiseDb?: string;
  /** Minimum silence length in seconds (default 0.4). */
  minDuration?: number;
  durationUs?: number;
}

/** Silence regions via ffmpeg's silencedetect filter. */
export async function detectAudioRegions(path: string, options: DetectAudioOptions = {}): Promise<AudioRegion[]> {
  const noise = options.noiseDb ?? '-30dB';
  const minDuration = options.minDuration ?? 0.4;
  const result = await runTool('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', path,
    '-af', 'silencedetect=noise=' + noise + ':d=' + minDuration,
    '-f', 'null', '-',
  ], { timeoutMs: 600_000 });
  const regions: AudioRegion[] = [];
  let silenceStart: number | null = null;
  for (const line of (result.stderr ?? '').split(/[\r\n]+/)) {
    const start = /silence_start: ?([0-9]+(?:\.[0-9]+)?)/.exec(line);
    const end = /silence_end: ?([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (start) silenceStart = Number(start[1]);
    if (end && silenceStart !== null) {
      regions.push({ startUs: us(silenceStart), endUs: us(Number(end[1])), silent: true });
      silenceStart = null;
    }
  }
  // Fill the non-silent gaps so the full timeline is covered (when audio exists).
  const sorted = regions.sort((a, b) => a.startUs - b.startUs);
  const filled: AudioRegion[] = [];
  let cursor = 0;
  const durationUs = options.durationUs ?? 0;
  for (const region of sorted) {
    if (region.startUs > cursor) filled.push({ startUs: cursor, endUs: region.startUs, silent: false });
    filled.push(region);
    cursor = region.endUs;
  }
  if (durationUs > 0 && cursor < durationUs) filled.push({ startUs: cursor, endUs: durationUs, silent: false });
  return filled;
}

/** Level 1 analysis: shots + keyframe points + audio regions. */
export async function analyzeMedia(path: string, options: { durationUs?: number } = {}): Promise<MediaAnalysis> {
  const [shots, audioRegions] = await Promise.all([
    detectShots(path, { durationUs: options.durationUs }),
    detectAudioRegions(path, { durationUs: options.durationUs }),
  ]);
  const durationUs = options.durationUs ?? (shots.length > 0 ? shots[shots.length - 1]!.endUs : 0);
  return {
    durationUs,
    shots,
    keyframeAtUs: shots.map((shot) => Math.round((shot.startUs + shot.endUs) / 2)),
    audioRegions,
  };
}
/** Mean inter-frame luma difference per shot (0-255) - a cheap activity
 * signal. One extra decode pass over the video (signalstats YDIF per
 * frame); the first frame of each shot is skipped so the cut spike does
 * not count. */
export async function detectShotMotion(path: string, shots: Shot[], options: { timeoutMs?: number } = {}): Promise<number[]> {
  const result = await runTool('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', path,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-',
    '-an', '-f', 'null', '-',
  ], { timeoutMs: options.timeoutMs ?? 600_000 });
  const frames: Array<{ t: number; y: number }> = [];
  let currentT: number | null = null;
  const text = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
  for (const line of text.split(/[\r\n]+/)) {
    if (line.startsWith('frame:')) {
      const t = /pts_time:([0-9]+(?:\.[0-9]+)?)/.exec(line);
      currentT = t ? Number(t[1]) : currentT;
      continue;
    }
    const y = /lavfi\.signalstats\.YDIF=([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (y && currentT !== null) {
      frames.push({ t: currentT, y: Number(y[1]) });
      currentT = null;
    }
  }
  const sums: number[] = shots.map(() => 0);
  const counts: number[] = shots.map(() => 0);
  let shotIndex = 0;
  for (const frame of frames) {
    while (shotIndex < shots.length - 1 && frame.t >= shots[shotIndex]!.endUs / 1_000_000) shotIndex += 1;
    if (shotIndex >= shots.length) break;
    // Skip the shot's first frame: YDIF there measures the cut, not motion.
    if (frame.t < shots[shotIndex]!.startUs / 1_000_000 + 0.001) continue;
    sums[shotIndex] = (sums[shotIndex] ?? 0) + frame.y;
    counts[shotIndex] = (counts[shotIndex] ?? 0) + 1;
  }
  return shots.map((_, i) => (counts[i]! > 0 ? sums[i]! / counts[i]! : 0));
}

/** Level 1 analysis plus per-shot motion scores. */
export interface MediaAnalysisLevel2 extends MediaAnalysis {
  /** Per-shot mean inter-frame luma change (0-255); see classifyShots. */
  motionPerShot: number[];
}

export async function analyzeMediaLevel2(path: string, options: { durationUs?: number } = {}): Promise<MediaAnalysisLevel2> {
  const level1 = await analyzeMedia(path, options);
  const motionPerShot = level1.shots.length > 0 ? await detectShotMotion(path, level1.shots) : [];
  return { ...level1, motionPerShot };
}

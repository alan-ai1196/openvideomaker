import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runTool } from './run.js';
import { MediaError, type ThumbnailOptions } from './types.js';

/**
 * Extract a filmstrip of jpg thumbnails with ffmpeg into cacheDir.
 * Frames are evenly spaced across the source duration. Returns data URLs
 * (bounded size) plus the files, in time order.
 */
export async function extractThumbnails(
  path: string,
  durationUs: number,
  options: ThumbnailOptions & { cacheDir: string; ffmpeg?: string; timeoutMs?: number },
): Promise<string[]> {
  const width = options.width ?? 192;
  const seconds = Math.max(0.2, durationUs / 1_000_000);
  const count = Math.max(1, Math.min(options.count ?? Math.ceil(seconds / 1.5), 16));
  const quality = options.quality ?? 4;
  mkdirSync(options.cacheDir, { recursive: true });
  const stem = basename(path).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_');
  const outPattern = join(options.cacheDir, stem + '-%02d.jpg');
  const binary = options.ffmpeg ?? process.env.OVM_FFMPEG ?? 'ffmpeg';
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', path,
    '-vf', 'fps=1/' + Math.max(0.1, seconds / count) + ',scale=' + width + ':-2',
    '-frames:v', String(count),
    '-q:v', String(quality),
    '-y',
    outPattern,
  ];
  const result = await runTool(binary, args, { timeoutMs: options.timeoutMs ?? 120_000 });
  if (result.code !== 0) {
    throw new MediaError('probe.failed', 'ffmpeg thumbnail extraction failed: ' + result.stderr.trim().split('\n')[0], { command: binary });
  }
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const file = join(options.cacheDir, stem + '-' + String(i).padStart(2, '0') + '.jpg');
    if (existsSync(file)) out.push('data:image/jpeg;base64,' + readFileSync(file).toString('base64'));
  }
  return out;
}
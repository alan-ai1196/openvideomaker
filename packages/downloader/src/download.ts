import { createWriteStream, existsSync, statSync, rmSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { DownloadError } from './types.js';

export interface DownloadProgress {
  bytes: number;
  totalBytes: number | null;
}

export interface DownloadFileOptions {
  url: string;
  dest: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Download a file with resumable Range support, progress, and
 * cancellation. Mirrors that ignore Range fall back to a full download.
 * On success the file sits at dest with its final name; partial state
 * lives in dest.part and is resumed on the next attempt.
 */
export async function downloadFile(options: DownloadFileOptions): Promise<void> {
  const { url, dest } = options;
  mkdirSync(dirname(dest), { recursive: true });
  const partial = dest + '.part';
  const existing = existsSync(partial) ? statSync(partial).size : 0;

  const signal = options.timeoutMs
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)].filter(Boolean) as AbortSignal[])
    : options.signal;

  const headers: Record<string, string> = {};
  if (existing > 0) headers.range = 'bytes=' + existing + '-';
  const response = await fetch(url, { headers, signal, redirect: 'follow' });
  if (response.status !== 200 && response.status !== 206) {
    throw new DownloadError('download.failed', 'download failed with HTTP ' + response.status + ' for ' + url);
  }
  const body = response.body;
  if (!body) throw new DownloadError('download.failed', 'empty response body for ' + url);

  const resume = response.status === 206;
  if (!resume) rmSync(partial, { force: true });
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const totalBytes = contentLength > 0 ? existing + contentLength : null;
  let written = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length;
      options.onProgress?.({ bytes: existing + written, totalBytes });
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(partial, { flags: resume ? 'a' : 'w' }));
  renameSync(partial, dest);
}

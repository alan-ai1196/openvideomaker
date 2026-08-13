import { spawn } from 'node:child_process';
import { MediaError } from './types.js';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run an external media tool (ffprobe/ffmpeg) with argument arrays only -
 * never shell interpolation. Output is captured with bounded size; binary
 * media never travels through here.
 */
export function runTool(binary: string, args: string[], options?: { timeoutMs?: number; maxOutputBytes?: number }): Promise<RunResult> {
  const maxBytes = options?.maxOutputBytes ?? 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    const timer = options?.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length <= maxBytes) stdout += chunk.toString('utf8');
      else overflow = true;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length + chunk.length <= maxBytes) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        reject(new MediaError('tool.missing', binary + ' was not found on PATH', { command: binary }));
      } else {
        reject(new MediaError('io.failed', 'failed to start ' + binary + ': ' + e.message, { command: binary, cause: err }));
      }
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout: overflow ? stdout + '\n[output truncated]' : stdout, stderr });
    });
  });
}

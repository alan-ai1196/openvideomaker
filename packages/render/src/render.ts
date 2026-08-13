import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import type { RenderPlan } from './plan.js';

export type RenderJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RenderJobEvent {
  state: RenderJobState;
  progress: number;
  stage: string;
}

/**
 * A render job: durable state, progress, bounded logs, cancellation.
 * This is the seed of the Job Center model - jobs are how long-running
 * work becomes visible instead of freezing the editor.
 */
export class RenderJob {
  readonly id: string;
  state: RenderJobState = 'queued';
  progress = 0;
  stage = 'queued';
  logs: string[] = [];
  error: string | null = null;
  outputPath: string | null = null;
  #child: ChildProcess | null = null;
  #listeners = new Set<(event: RenderJobEvent) => void>();

  constructor(id: string) {
    this.id = id;
  }

  subscribe(listener: (event: RenderJobEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  cancel(): void {
    if (this.state === 'running' && this.#child) {
      this.#child.kill();
      this.state = 'cancelled';
      this.emit('cancelled');
    }
  }

  /** @internal Attach the running process; the executor owns the lifecycle. */
  attach(child: ChildProcess | null): void {
    this.#child = child;
  }

  /** @internal Notify subscribers; public for the executor. */
  emit(stage: string): void {
    for (const listener of this.#listeners) listener({ state: this.state, progress: this.progress, stage });
  }
}

/**
 * Execute a render plan with ffmpeg: progress parsing, bounded log
 * capture, cancellation, and explicit failure reporting. Never throws
 * for expected failures - the job carries the truth.
 */
export async function runRenderJob(plan: RenderPlan, job: RenderJob, options?: { ffmpeg?: string; timeoutMs?: number }): Promise<RenderJob> {
  if (plan.errors.length > 0) {
    job.state = 'failed';
    job.error = plan.errors.join('; ');
    job.emit('validation');
    return job;
  }
  const binary = options?.ffmpeg ?? process.env.OVM_FFMPEG ?? 'ffmpeg';
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    '-nostats',
    ...plan.sources.flatMap((source) => ['-i', source.path]),
    '-filter_complex', plan.filterComplex,
    ...plan.outputArgs,
  ];
  job.state = 'running';
  job.stage = 'encoding';
  job.emit('encoding');
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    job.attach(child);
    let stderrTail = '';
    const timer = options?.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const match = /^out_time_ms=(\d+)/.exec(line.trim());
        if (match) {
          job.progress = Math.min(1, Number(match[1]) / 1_000_000 / (plan.durationUs / 1_000_000));
          job.emit('progress');
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-24000);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      job.state = 'failed';
      job.error = 'failed to start ffmpeg: ' + err.message;
      job.attach(null);
      job.emit('error');
      resolve(job);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      job.attach(null);
      if (job.state === 'cancelled') {
        resolve(job);
        return;
      }
      if (code === 0 && existsSync(plan.options.outputPath)) {
        job.state = 'completed';
        job.progress = 1;
        job.outputPath = plan.options.outputPath;
      } else {
        job.state = 'failed';
        job.error = classifyRenderError(stderrTail);
        for (const line of stderrTail.trim().split('\n').filter(Boolean).slice(-8)) job.logs.push(line);
      }
      for (const temp of plan.tempFiles) {
        try { unlinkSync(temp); } catch { /* already gone */ }
      }
      job.emit(job.state);
      resolve(job);
    });
  });
}

/**
 * One-shot convenience: render a plan and wait for the finished job.
 * When a hardware encoder fails, retries once with the software encoder -
 * hardware is an accelerator, never a hard requirement.
 */
export async function render(plan: RenderPlan, id?: string): Promise<RenderJob> {
  const job = await runRenderJob(plan, new RenderJob(id ?? 'render_' + Date.now()));
  if (job.state === 'failed' && plan.encoder.hardware && plan.options.videoCodec !== 'hevc') {
    const softwarePlan: RenderPlan = {
      ...plan,
      encoder: { name: 'libx264', codec: 'h264', hardware: false, label: 'libx264 (software fallback)' },
      outputArgs: plan.outputArgs.map((arg, index, args) => {
        if (args[index - 1] === '-c:v') return 'libx264';
        if (args[index - 1] === '-preset') return 'medium';
        if (args[index - 1] === '-cq') return '26';
        return arg;
      }),
    };
    return runRenderJob(softwarePlan, new RenderJob((id ?? 'render') + '-sw'));
  }
  return job;
}

/** Parse ffmpeg failures into creator-facing explanations with next steps. */
export function classifyRenderError(stderr: string): string {
  if (/out of memory|cannot allocate memory/i.test(stderr)) {
    return 'This render needs more memory than is currently available. Try a lower resolution or close other applications.';
  }
  if (/unknown encoder|encoder.*not found/i.test(stderr)) {
    return 'This ffmpeg build does not support the selected encoder. Choose the software encoder instead.';
  }
  if (/Error opening input|No such file or directory|Invalid data found when processing input/i.test(stderr)) {
    return 'A source file could not be found. Check that the project media is still available.';
  }
  return 'Rendering failed. See the job log for details.';
}

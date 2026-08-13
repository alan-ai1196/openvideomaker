import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  CancelRequestSchema,
  DescribeRequestSchema,
  DescribeResponseSchema,
  DisposeRequestSchema,
  ErrorResponseSchema,
  ExecuteRequestSchema,
  ExecuteResponseSchema,
  HealthRequestSchema,
  MAX_MESSAGE_BYTES,
  PrepareRequestSchema,
  PrepareResponseSchema,
  RunnerEventSchema,
  frame,
  type HostRequest,
  type RunnerEvent,
  type RunnerResponse,
} from './protocol.js';

export class RunnerError extends Error {
  readonly code: 'runner.crash' | 'runner.timeout' | 'runner.spawn' | 'runner.protocol' | 'runner.failed';
  constructor(code: RunnerError['code'], message: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}

export interface RunnerSpawnOptions {
  command: string;
  args: string[];
  /** Clean environment: only PATH/HOME + these keys pass to the runner. */
  envAllow?: string[];
  cwd?: string;
}

export interface PendingRequest {
  resolve: (value: RunnerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A single runner process: request/response correlation, unsolicited
 * events, bounded log capture, and crash isolation - a crashed runner
 * fails its pending job and never the host process.
 */
export class RunnerHost {
  #child: ChildProcess | null = null;
  #pending = new Map<string, PendingRequest>();
  #seq = 0;
  #crashed = false;
  #logs: string[] = [];
  #events = new Set<(event: RunnerEvent) => void>();

  constructor(readonly options: RunnerSpawnOptions) {}

  get logs(): readonly string[] {
    return this.#logs;
  }

  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  start(): void {
    const env: Record<string, string> = {};
    for (const key of this.options.envAllow ?? []) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    const child = spawn(this.options.command, this.options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd,
      env: { ...env, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
      windowsHide: true,
    });
    this.#child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (line.length > MAX_MESSAGE_BYTES) {
        this.#log('error', 'oversized runner message dropped');
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.#log('error', 'unparseable runner message: ' + line.slice(0, 200));
        return;
      }
      this.#handle(message);
    });
    const errLines = createInterface({ input: child.stderr });
    errLines.on('line', (line) => this.#log('error', line));
    child.on('error', (err) => {
      this.#failPending(new RunnerError('runner.spawn', 'failed to start runner: ' + err.message));
    });
    child.on('close', (code) => {
      this.#log('info', 'runner exited with code ' + String(code));
      this.#crashed = true;
      this.#failPending(new RunnerError('runner.crash', 'runner exited unexpectedly (code ' + String(code) + ')'));
    });
  }

  #log(level: 'info' | 'error', message: string): void {
    this.#logs.push(level + ': ' + message);
    if (this.#logs.length > 200) this.#logs.shift();
    this.#emit({ kind: 'log', level: level === 'info' ? 'info' : 'error', message });
  }

  #emit(event: RunnerEvent): void {
    for (const listener of this.#events) listener(event);
  }

  #handle(message: unknown): void {
    const event = RunnerEventSchema.safeParse(message);
    if (event.success) {
      this.#emit(event.data);
      return;
    }
    const candidate = message as { id?: unknown };
    if (typeof candidate?.id !== 'string') {
      this.#log('error', 'runner message without a valid id');
      return;
    }
    const pending = this.#pending.get(candidate.id);
    if (!pending) {
      this.#log('error', 'response for unknown request id');
      return;
    }
    this.#pending.delete(candidate.id);
    clearTimeout(pending.timer);
    const ok = (message as { ok?: unknown }).ok;
    if (ok === false) {
      const parsed = ErrorResponseSchema.safeParse(message);
      if (parsed.success) {
        pending.reject(new RunnerError('runner.failed', parsed.data.error.code + ': ' + parsed.data.error.message));
      } else {
        pending.reject(new RunnerError('runner.protocol', 'malformed error response'));
      }
      return;
    }
    const parsed = this.#parseResponse(message);
    if (parsed) pending.resolve(parsed);
    else pending.reject(new RunnerError('runner.protocol', 'malformed response'));
  }

  #parseResponse(message: unknown): RunnerResponse | null {
    // Discriminate by payload shape: zod's permissive object parsing would
    // otherwise let the prepare schema swallow execute responses.
    const record = message as Record<string, unknown>;
    if (record && 'outputs' in record) {
      const parsed = ExecuteResponseSchema.safeParse(message);
      return parsed.success ? parsed.data : null;
    }
    if (record && 'protocolVersion' in record) {
      const parsed = DescribeResponseSchema.safeParse(message);
      return parsed.success ? parsed.data : null;
    }
    const parsed = PrepareResponseSchema.safeParse(message);
    return parsed.success ? parsed.data : null;
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #request(request: HostRequest, timeoutMs: number): Promise<RunnerResponse> {
    if (!this.#child || this.#crashed) {
      return Promise.reject(new RunnerError('runner.crash', 'runner is not running'));
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(request.id);
          reject(new RunnerError('runner.timeout', request.method + ' timed out'));
        }, timeoutMs),
      });
      this.#child!.stdin!.write(frame(request));
    });
  }

  describe(timeoutMs = 30_000): Promise<RunnerResponse> {
    const id = 'r' + ++this.#seq;
    return this.#request(DescribeRequestSchema.parse({ id, method: 'describe' }), timeoutMs);
  }

  prepare(params: { capability: string; modelId: string; modelFiles?: Record<string, { path: string; sha256?: string }>; device?: 'cuda' | 'cpu' | 'mlx' | 'rocm' }, timeoutMs = 600_000): Promise<RunnerResponse> {
    const id = 'r' + ++this.#seq;
    return this.#request(PrepareRequestSchema.parse({ id, method: 'prepare', params }), timeoutMs);
  }

  execute(params: { capability: string; modelId: string; inputs?: Record<string, { path: string; sha256?: string }>; settings?: Record<string, unknown>; outputDir: string }, timeoutMs = 3_600_000): Promise<RunnerResponse> {
    const id = 'r' + ++this.#seq;
    return this.#request(ExecuteRequestSchema.parse({ id, method: 'execute', params }), timeoutMs);
  }

  cancel(): void {
    const id = 'r' + ++this.#seq;
    this.#request(CancelRequestSchema.parse({ id, method: 'cancel' }), 5_000).catch(() => undefined);
  }

  health(timeoutMs = 10_000): Promise<RunnerResponse> {
    const id = 'r' + ++this.#seq;
    return this.#request(HealthRequestSchema.parse({ id, method: 'health' }), timeoutMs);
  }

  dispose(): void {
    const id = 'r' + ++this.#seq;
    this.#request(DisposeRequestSchema.parse({ id, method: 'dispose' }), 5_000).catch(() => undefined);
    this.#child?.stdin?.end();
  }
}

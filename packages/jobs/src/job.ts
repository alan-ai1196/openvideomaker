import type { GenerationProvenance } from '@openvideomaker/schema';

export type GenerationJobState =
  | 'queued'
  | 'installing'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GenerationJobEvent {
  state: GenerationJobState;
  stage: string;
  /** 0..1 where the stage has a known total; 0 otherwise. */
  progress: number;
  bytes: number;
  totalBytes: number | null;
}

export interface GenerationJobOutput {
  path: string;
  sha256?: string;
}

/**
 * A single generation run: install -> runtime -> runner protocol.
 * Same shape as RenderJob/DownloadJob so the future Job Center can
 * present all of them uniformly.
 */
export class GenerationJob {
  readonly id: string;
  readonly capability: string;
  readonly modelId: string;
  state: GenerationJobState = 'queued';
  stage = 'queued';
  progress = 0;
  bytes = 0;
  totalBytes: number | null = null;
  error: string | null = null;
  logs: string[] = [];
  outputs: Record<string, GenerationJobOutput> = {};
  metadata: Record<string, unknown> = {};
  /** Raw provenance record, filled when the run completes. */
  provenance: GenerationProvenance | null = null;
  readonly startedAt: string;
  finishedAt: string | null = null;
  #listeners = new Set<(event: GenerationJobEvent) => void>();
  #cancelRequested = false;
  #finished: Promise<void> = Promise.resolve();

  constructor(id: string, capability: string, modelId: string, startedAt = new Date().toISOString()) {
    this.id = id;
    this.capability = capability;
    this.modelId = modelId;
    this.startedAt = startedAt;
  }

  subscribe(listener: (event: GenerationJobEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get cancelRequested(): boolean {
    return this.#cancelRequested;
  }

  /** Resolves when the run settles (completed, failed or cancelled). */
  get finished(): Promise<void> {
    return this.#finished;
  }

  /** @internal */
  attachRun(promise: Promise<GenerationJob>): void {
    this.#finished = promise.then(() => undefined);
  }

  /** Best-effort cancellation: aborts the install or signals the runner. */
  cancel(): void {
    this.#cancelRequested = true;
    if (this.state === 'queued' || this.state === 'installing' || this.state === 'preparing' || this.state === 'running') {
      this.state = 'cancelled';
      this.emit('cancelled');
    }
  }

  emit(stage: string): void {
    for (const listener of this.#listeners) {
      listener({ state: this.state, stage, progress: this.progress, bytes: this.bytes, totalBytes: this.totalBytes });
    }
  }

  log(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
  }
}

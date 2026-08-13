export class DownloadError extends Error {
  readonly code: 'download.failed' | 'download.integrity' | 'download.cancelled' | 'download.no-sources' | 'install.no-manifest' | 'store.invalid-path' | 'store.busy';
  constructor(code: DownloadError['code'], message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

/** Source priority profiles; mirrors are configured, never hardcoded. */
export type SourceProfile = 'auto' | 'global' | 'mainland-china' | 'custom';

export type DownloadJobState = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadJobEvent {
  state: DownloadJobState;
  /** Bytes downloaded across all files. */
  bytes: number;
  /** Total bytes when known, else null. */
  totalBytes: number | null;
  stage: string;
}

/**
 * A model download job - same shape as RenderJob so the future Job Center
 * can present both uniformly.
 */
export class DownloadJob {
  readonly id: string;
  state: DownloadJobState = 'queued';
  bytes = 0;
  totalBytes: number | null = null;
  stage = 'queued';
  error: string | null = null;
  logs: string[] = [];
  #controller: AbortController | null = null;
  #listeners = new Set<(event: DownloadJobEvent) => void>();

  constructor(id: string) {
    this.id = id;
  }

  subscribe(listener: (event: DownloadJobEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  cancel(): void {
    if (this.state === 'downloading') {
      this.#controller?.abort();
      this.state = 'cancelled';
      this.emit('cancelled');
    }
  }

  /** @internal */
  attach(controller: AbortController | null): void {
    this.#controller = controller;
  }

  /** @internal */
  emit(stage: string): void {
    for (const listener of this.#listeners) listener({ state: this.state, bytes: this.bytes, totalBytes: this.totalBytes, stage });
  }

  log(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
  }
}

export interface ModelManifest {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  installedAt: string;
  files: Array<{ path: string; sha256: string; sizeBytes: number }>;
}

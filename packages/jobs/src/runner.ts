import { join } from 'node:path';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, RunnerError, UvRuntime } from '@openvideomaker/runners';
import type { Registry } from '@openvideomaker/registry';
import type { GenerationInput, GenerationProvenance } from '@openvideomaker/schema';
import { GenerationJob } from './job.js';
import { loadRunnerIndex, type RunnerManifest } from './manifest.js';

export class GenerationError extends Error {
  readonly code:
    | 'jobs.model-unknown'
    | 'jobs.capability-mismatch'
    | 'jobs.runner-unknown'
    | 'jobs.install-failed'
    | 'jobs.runtime-failed'
    | 'jobs.prepare-failed'
    | 'jobs.execute-failed'
    | 'jobs.output-missing'
    | 'jobs.output-invalid'
    | 'jobs.not-completed'
    | 'jobs.input-denied'
    | 'jobs.cancelled';
  constructor(code: GenerationError['code'], message: string) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
  }
}

export interface GenerationRequest {
  capability: string;
  modelId: string;
  /** Input file refs resolved by the caller (adapter-specific keys). */
  inputs?: Record<string, { path: string; sha256?: string }>;
  /**
   * Model-owned input files: adapter input key -> path inside the
   * registry entry's file manifest (e.g. { voice: 'voices/af_heart.pt' }).
   * Resolved through the content store, so callers never need to know
   * where weights live.
   */
  modelInputs?: Record<string, string>;
  settings?: Record<string, unknown>;
  device?: 'cuda' | 'cpu' | 'mlx' | 'rocm';
  outputDir: string;
  /** Project-scoped provenance inputs (e.g. the source asset). */
  provenanceInputs?: GenerationInput[];
  revision?: string;
  profile?: 'auto' | 'global' | 'mainland-china' | 'custom';
  timeouts?: { prepare?: number; execute?: number };
}

export interface GenerationRunnerOptions {
  registry: Registry;
  store: ModelStore;
  runnersDir: string;
  runtimesDir?: string;
  uv?: string;
}

/**
 * Runs capability requests against verified runner adapters: installs
 * the model through the artifact store, prepares an isolated runtime,
 * and executes through the NDJSON runner protocol. Never imports
 * model-specific code: modelId -> adapter resolution is data-driven
 * from runners/<name>/runner.json manifests.
 */
export class GenerationRunner {
  readonly registry: Registry;
  readonly store: ModelStore;
  readonly runnersDir: string;
  readonly runtimesDir?: string;
  readonly uv?: string;
  readonly index: ReturnType<typeof loadRunnerIndex>;

  constructor(options: GenerationRunnerOptions) {
    this.registry = options.registry;
    this.store = options.store;
    this.runnersDir = options.runnersDir;
    this.runtimesDir = options.runtimesDir;
    this.uv = options.uv;
    this.index = loadRunnerIndex(options.runnersDir);
  }

  /** Start a generation; the job is returned immediately and cancellable via job.cancel(). */
  run(request: GenerationRequest): GenerationJob {
    const job = new GenerationJob(globalThis.crypto.randomUUID(), request.capability, request.modelId);
    job.attachRun(this.#run(job, request));
    return job;
  }

  async #run(job: GenerationJob, request: GenerationRequest): Promise<GenerationJob> {
    const abort = new AbortController();
    job.subscribe((event) => {
      if (event.state === 'cancelled') {
        abort.abort();
        host?.cancel();
      }
    });
    let host: RunnerHost | null = null;
    try {
      const entry = this.registry.byId(request.modelId);
      if (!entry) throw new GenerationError('jobs.model-unknown', 'no registry entry for ' + request.modelId);
      if (!entry.capabilities.includes(request.capability)) {
        throw new GenerationError('jobs.capability-mismatch', request.modelId + ' does not declare capability ' + request.capability);
      }
      const manifest = this.index.byModelId(request.modelId);
      const adapterDir = this.index.dirOf(request.modelId);
      if (!manifest || !adapterDir) {
        throw new GenerationError('jobs.runner-unknown', 'no runner adapter for ' + request.modelId);
      }
      const revision = request.revision ?? 'main';

      job.state = 'installing';
      job.emit('installing');
      const install = await installModel(this.store, entry, {
        profile: request.profile,
        revision: request.revision,
        signal: abort.signal,
        onProgress: (d) => {
          job.bytes = d.bytes;
          job.totalBytes = d.totalBytes;
          job.progress = d.totalBytes ? Math.min(1, d.bytes / d.totalBytes) : 0;
          job.stage = 'installing:' + d.stage;
          job.emit('progress');
        },
      });
      if (install.state === 'cancelled') throw new GenerationError('jobs.cancelled', 'model download cancelled');
      if (install.state !== 'completed') throw new GenerationError('jobs.install-failed', install.error ?? 'model install failed');
      if (job.cancelRequested) throw new GenerationError('jobs.cancelled', 'generation cancelled');

      job.state = 'preparing';
      job.stage = 'preparing:runtime';
      job.emit('runtime');
      let env;
      try {
        const runtime = new UvRuntime({ runtimesDir: this.runtimesDir, uv: this.uv });
        env = await runtime.ensure(manifest.name, adapterDir, manifest.pythonVersion);
      } catch (error) {
        throw new GenerationError('jobs.runtime-failed', (error as Error).message);
      }
      if (job.cancelRequested) throw new GenerationError('jobs.cancelled', 'generation cancelled');

      job.stage = 'preparing:model';
      job.emit('prepare');
      host = new RunnerHost({
        command: env.pythonPath,
        args: [join(adapterDir, manifest.entry)],
        envAllow: [],
      });
      host.subscribe((event) => {
        if (event.kind === 'log') {
          job.log(event.message);
          job.emit('log');
        } else if (event.kind === 'progress') {
          job.stage = event.stage;
          job.emit('progress');
        } else if (event.kind === 'cancelled') {
          job.state = 'cancelled';
          job.emit('cancelled');
        }
      });
      host.start();
      try {
        // Cold start includes the adapter's module imports (heavy models
        // pre-import before their protocol loop starts), so allow 2 minutes.
        const description = await host.describe(120_000);
        if (!('protocolVersion' in description)) throw new GenerationError('jobs.prepare-failed', 'runner describe failed');
        const modelFiles = Object.fromEntries(
          Object.entries(manifest.modelFiles).map(([key, path]) => [key, { path: this.store.filePath(entry.id, revision, path) }]),
        );
        const prepare = await host.prepare(
          { capability: request.capability, modelId: request.modelId, modelFiles, device: request.device },
          request.timeouts?.prepare ?? 600_000,
        );
        if (!('estimate' in prepare)) throw new GenerationError('jobs.prepare-failed', 'runner prepare failed');

        job.state = 'running';
        job.stage = 'running';
        job.emit('running');
        // Model-owned inputs resolve against the pinned revision, so the
        // exact artifact the job runs on is the one that was installed.
        const inputs: Record<string, { path: string; sha256?: string }> = { ...(request.inputs ?? {}) };
        for (const [key, manifestPath] of Object.entries(request.modelInputs ?? {})) {
          inputs[key] = { path: this.store.filePath(entry.id, revision, manifestPath) };
        }
        const execute = await host.execute(
          {
            capability: request.capability,
            modelId: request.modelId,
            inputs,
            settings: request.settings ?? {},
            outputDir: request.outputDir,
          },
          request.timeouts?.execute ?? 3_600_000,
        );
        if (!('outputs' in execute)) throw new GenerationError('jobs.execute-failed', 'runner execute failed');
        if (job.cancelRequested || (job.state as string) === 'cancelled') throw new GenerationError('jobs.cancelled', 'generation cancelled');
        job.outputs = execute.outputs;
        job.metadata = execute.metadata ?? {};
        job.provenance = buildProvenance(entry.id, manifest, request, revision, Boolean(entry.files && entry.files.length > 0));
        job.state = 'completed';
        job.stage = 'completed';
        job.progress = 1;
        job.emit('completed');
      } finally {
        host.dispose();
        host = null;
      }
    } catch (error) {
      if (job.state !== 'completed' && job.state !== 'cancelled') {
        job.state = 'failed';
        job.error = error instanceof GenerationError ? error.code + ': ' + error.message : error instanceof Error ? error.message : String(error);
        job.emit('failed');
      }
    } finally {
      abort.abort();
    }
    job.finishedAt = new Date().toISOString();
    return job;
  }
}

function buildProvenance(modelId: string, manifest: RunnerManifest, request: GenerationRequest, revision: string, regenerable: boolean): GenerationProvenance {
  return {
    capability: request.capability,
    model: { id: modelId, revision, source: 'local' },
    runner: { kind: 'local-python', version: manifest.version },
    settings: request.settings ?? {},
    inputs: request.provenanceInputs ?? [],
    generatedAt: new Date().toISOString(),
    ...(request.device ? { device: { kind: request.device } } : {}),
    regenerable,
  };
}

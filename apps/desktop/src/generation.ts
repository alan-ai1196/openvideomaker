import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ModelStore } from '@openvideomaker/downloader';
import { Registry } from '@openvideomaker/registry';
import { GenerationRunner, GenerationError, type GenerationJob } from '@openvideomaker/jobs';
import { probeMediaPath } from '@openvideomaker/media';
import { GenerationInputSchema, type GenerationProvenance, type MediaInfo } from '@openvideomaker/schema';

/**
 * Desktop-side generation: capability requests resolve through the same
 * GenerationRunner the SDK/CLI use (registry + content store + uv runtimes
 * + the runner protocol), so the desktop app runs EXACTLY the jobs the
 * core defines. The renderer only supplies semantic requests; media inputs
 * must already be known local paths (the ovm-media whitelist).
 */

export const DesktopGenerateRequestSchema = z.object({
  capability: z.string().min(1),
  modelId: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).optional(),
  inputs: z.record(z.string(), z.object({ path: z.string().min(1) })).optional(),
  modelInputs: z.record(z.string(), z.string().min(1)).optional(),
  device: z.enum(['cuda', 'cpu', 'mlx', 'rocm']).optional(),
  provenanceInputs: z.array(GenerationInputSchema).optional(),
});
export type DesktopGenerateRequest = z.infer<typeof DesktopGenerateRequestSchema>;

export interface DesktopGenerateResult {
  jobId: string;
  state: string;
  outputs: Record<string, DesktopOutput>;
  metadata: Record<string, unknown>;
  provenance: GenerationProvenance | null;
  error: string | null;
}

export interface DesktopOutput {
  path: string;
  sha256?: string;
  /** Present when the output is probeable media. */
  media?: MediaInfo;
  /** Present when the output parses as JSON (e.g. a transcript). */
  json?: unknown;
}

export interface GenerationCapability {
  capability: string;
  modelId: string;
}

export interface DesktopGenerationServiceOptions {
  registryData: unknown;
  storeDir: string;
  runnersDir: string;
  runtimesDir: string;
  outputRoot: string;
  uv?: string;
  /** Deny generation inputs outside known media paths (the ovm-media whitelist). */
  allowInputPath(path: string): boolean;
}

export class DesktopGenerationService {
  readonly runner: GenerationRunner;
  readonly outputRoot: string;
  #allowInputPath: (path: string) => boolean;
  #jobs = new Map<string, GenerationJob>();

  constructor(options: DesktopGenerationServiceOptions) {
    this.outputRoot = options.outputRoot;
    this.#allowInputPath = options.allowInputPath;
    this.runner = new GenerationRunner({
      registry: Registry.fromData(options.registryData),
      store: new ModelStore(options.storeDir),
      runnersDir: options.runnersDir,
      runtimesDir: options.runtimesDir,
      uv: options.uv,
    });
  }

  /** Data-driven from runner manifests: which capability+model pairs can actually run locally. */
  capabilities(): GenerationCapability[] {
    return this.runner.index.manifests.flatMap((manifest) =>
      manifest.models.flatMap((modelId) => manifest.capabilities.map((capability) => ({ capability, modelId }))),
    );
  }

  generate(request: DesktopGenerateRequest): GenerationJob {
    for (const [key, input] of Object.entries(request.inputs ?? {})) {
      if (!this.#allowInputPath(input.path)) {
        throw new GenerationError('jobs.input-denied', 'input ' + key + ' is not a known media path on this computer');
      }
    }
    const job = this.runner.run({
      ...request,
      outputDir: join(this.outputRoot, 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
    });
    this.#jobs.set(job.id, job);
    void job.finished.then(() => this.#jobs.delete(job.id));
    return job;
  }

  cancel(jobId: string): boolean {
    const job = this.#jobs.get(jobId);
    if (!job) return false;
    job.cancel();
    return true;
  }
}

/**
 * Describe a finished job's outputs for the renderer: media outputs get
 * probed MediaInfo (so assets import with real metadata), JSON outputs
 * (transcripts) travel inline, everything else stays a plain file ref.
 * Shared by the IPC handler and the smoke test.
 */
export async function describeJobOutputs(job: GenerationJob): Promise<Record<string, DesktopOutput>> {
  const outputs: Record<string, DesktopOutput> = {};
  for (const [key, value] of Object.entries(job.outputs)) {
    const entry: DesktopOutput = { path: value.path, sha256: value.sha256 };
    try {
      entry.media = (await probeMediaPath(value.path)).media;
    } catch {
      try {
        const raw = readFileSync(value.path, 'utf8');
        if (raw.length <= 4 * 1024 * 1024) entry.json = JSON.parse(raw);
      } catch {
        // Not probeable media and not JSON - keep it a plain file reference.
      }
    }
    outputs[key] = entry;
  }
  return outputs;
}

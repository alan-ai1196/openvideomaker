/**
 * Runner manifests: data-driven discovery of first-party adapters.
 * Each runners/<name>/runner.json declares which models and
 * capabilities its adapter serves and how its files map to the
 * registry entry's file manifest.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const RunnerManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  models: z.array(z.string().min(1)),
  pythonVersion: z.string().default('3.12'),
  entry: z.string().default('runner.py'),
  /** Adapter file key -> path inside the registry entry's file manifest. */
  modelFiles: z.record(z.string(), z.string()).default({}),
});
export type RunnerManifest = z.infer<typeof RunnerManifestSchema>;

export interface RunnerIndex {
  manifests: RunnerManifest[];
  byModelId(modelId: string): RunnerManifest | null;
  /** Adapter directory for a model (repo-relative to runnersDir). */
  dirOf(modelId: string): string | null;
}

export function loadRunnerIndex(runnersDir: string): RunnerIndex {
  const manifests: RunnerManifest[] = [];
  const modelToManifest = new Map<string, RunnerManifest>();
  const modelToDir = new Map<string, string>();
  for (const name of readdirSync(runnersDir)) {
    const dir = join(runnersDir, name);
    const file = join(dir, 'runner.json');
    if (!existsSync(file)) continue;
    const manifest = RunnerManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    manifests.push(manifest);
    for (const modelId of manifest.models) {
      if (modelToManifest.has(modelId)) throw new Error('duplicate runner manifest for model ' + modelId);
      modelToManifest.set(modelId, manifest);
      modelToDir.set(modelId, dir);
    }
  }
  return {
    manifests,
    byModelId: (modelId) => modelToManifest.get(modelId) ?? null,
    dirOf: (modelId) => modelToDir.get(modelId) ?? null,
  };
}

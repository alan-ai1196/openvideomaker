import { z } from 'zod';
import { AssetIdSchema } from './ids.js';

/**
 * Every AI-generated artifact records provenance so a project remains
 * understandable even after the producing model is uninstalled: what
 * capability created it, with which model/revision, on which runner, from
 * which inputs, with which settings, and whether it can be regenerated.
 */
export const ModelRefSchema = z.object({
  /** Stable registry model id (e.g. "hf/example/latentsync-v1.1"). */
  id: z.string().min(1),
  /** Pinned upstream revision (commit hash / HF revision / tag) when known. */
  revision: z.string().optional(),
  source: z.enum(['hf', 'modelscope', 'mirror', 'local', 'comfyui', 'remote', 'other']).optional(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const RunnerKindSchema = z.enum(['local-python', 'mlx', 'comfyui', 'native', 'remote-http', 'mock']);
export type RunnerKind = z.infer<typeof RunnerKindSchema>;

export const RunnerRefSchema = z.object({
  kind: RunnerKindSchema,
  /** Worker id from the device graph, e.g. "worker://local-cuda-0". */
  workerId: z.string().optional(),
  /** Runner adapter version. */
  version: z.string().optional(),
});
export type RunnerRef = z.infer<typeof RunnerRefSchema>;

export const DeviceKindSchema = z.enum(['cuda', 'cpu', 'mlx', 'rocm', 'remote']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const GenerationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), role: z.string().optional(), assetId: AssetIdSchema }),
  z.object({ kind: z.literal('text'), role: z.string().optional(), text: z.string() }),
  z.object({ kind: z.literal('prompt'), role: z.string().optional(), prompt: z.string() }),
  z.object({ kind: z.literal('audio'), role: z.string().optional(), assetId: AssetIdSchema }),
]);
export type GenerationInput = z.infer<typeof GenerationInputSchema>;

export const GenerationProvenanceSchema = z.object({
  /** Capability id, e.g. "avatar.lip_sync" — never a model-specific name. */
  capability: z.string().min(1),
  model: ModelRefSchema,
  runner: RunnerRefSchema,
  /** Runner settings snapshot (JSON-able only). */
  settings: z.record(z.string(), z.unknown()),
  inputs: z.array(GenerationInputSchema),
  generatedAt: z.iso.datetime(),
  device: z
    .object({ kind: DeviceKindSchema, name: z.string().optional() })
    .optional(),
  /** Whether the artifact can be reproduced from the recorded inputs. */
  regenerable: z.boolean(),
  /** Set when this artifact regenerated a previous generated asset. */
  regeneratedFrom: AssetIdSchema.optional(),
});
export type GenerationProvenance = z.infer<typeof GenerationProvenanceSchema>;

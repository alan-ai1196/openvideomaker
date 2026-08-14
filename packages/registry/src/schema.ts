import { z } from 'zod';

/**
 * Trust states describe the EVIDENCE behind an entry, never a claim.
 * 'unverified' means metadata may be accurate but nothing has been run;
 * every entry in this pre-release registry starts there until a runner
 * slice actually exercises it.
 */
export const TrustSchema = z.enum(['core', 'verified', 'community', 'experimental', 'unverified']);
export type Trust = z.infer<typeof TrustSchema>;

export const PlatformSchema = z.enum(['cuda', 'mlx', 'rocm', 'cpu']);
export type Platform = z.infer<typeof PlatformSchema>;

export const HardwareStatusSchema = z.enum(['tested', 'expected', 'untested', 'unavailable']);
export type HardwareStatus = z.infer<typeof HardwareStatusSchema>;

export const RunnerKindSchema = z.enum(['local-python', 'mlx', 'comfyui', 'native', 'remote-http']);
export type RegistryRunnerKind = z.infer<typeof RunnerKindSchema>;

export const ModelSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hf'),
    repo: z.string().min(1),
    revision: z.string().optional(),
    /** Optional filename patterns to restrict the download set. */
    include: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('modelscope'),
    modelId: z.string().min(1),
    revision: z.string().optional(),
  }),
  z.object({
    kind: z.literal('http'),
    baseUrl: z.string().url(),
    /** path -> url */
    files: z.record(z.string(), z.string()),
  }),
]);
export type ModelSource = z.infer<typeof ModelSourceSchema>;

export const ModelFileSchema = z.object({
  path: z.string().min(1),
  /** Content sha256 - the authoritative integrity pin. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /**
   * Content sha1 (40 hex) for sources that expose one. NOTE: the HF
   * tree API `oid` is a git blob id for non-LFS files (NOT the content
   * sha1), so never seed it here - measure content hashes instead.
   * HF LFS files expose their real content sha256 under `lfs.oid`.
   */
  sha1: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  required: z.boolean().default(true),
});
export type ModelFile = z.infer<typeof ModelFileSchema>;

export const ModelEntrySchema = z.object({
  schemaVersion: z.literal(1),
  /** Stable id, prefixed by source: 'hf/<owner>/<repo>', 'ms/<org>/<name>' or 'gh/<owner>/<repo>-<asset>'. */
  id: z.string().min(1),
  displayName: z.string().min(1),
  category: z.enum(['speech', 'lip-sync', 'video-generation', 'images', 'enhancement']),
  description: z.string().min(1),
  upstream: z.object({
    project: z.string().min(1),
    url: z.string().url(),
    licenseSpdx: z.string().optional(),
  }),
  capabilities: z.array(z.string().min(1)),
  runner: z.object({
    kind: RunnerKindSchema,
    minVersion: z.string().optional(),
    notes: z.string().optional(),
  }),
  hardware: z.array(z.object({ platform: PlatformSchema, status: HardwareStatusSchema })),
  /** Memory guidance only when evidence exists; never invented numbers. */
  memory: z.object({
    vramBytes: z.number().int().positive().optional(),
    note: z.string().optional(),
  }),
  precision: z.array(z.string()).optional(),
  license: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url().optional(),
    note: z.string().optional(),
  }),
  sources: z.array(ModelSourceSchema).min(1),
  files: z.array(ModelFileSchema).optional(),
  limitations: z.array(z.string()).default([]),
  verification: z.object({
    trust: TrustSchema,
    /** What the evidence actually is - a sentence, not a status label. */
    evidence: z.string().min(1),
    verifiedAt: z.string().optional(),
  }),
  updatePolicy: z.object({
    kind: z.enum(['manual', 'registry-pr', 'auto-discovery']),
    upstreamWatch: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('hf-repo'), id: z.string() }),
        z.object({ kind: z.literal('git-release'), url: z.string() }),
        z.object({ kind: z.literal('modelscope-repo'), id: z.string() }),
      ])
      .optional(),
  }),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

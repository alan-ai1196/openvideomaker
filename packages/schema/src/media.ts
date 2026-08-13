import { z } from 'zod';
import { AssetIdSchema } from './ids.js';
import { RationalFpsSchema } from './time.js';
import { GenerationProvenanceSchema } from './provenance.js';

/** Probed media characteristics. Absent until media has been indexed/probed. */
export const MediaInfoSchema = z.object({
  /** Full source duration in µs. */
  durationUs: z.number().int().nonnegative(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: RationalFpsSchema.optional(),
  codec: z.string().optional(),
  audioChannels: z.number().int().positive().optional(),
  sampleRate: z.number().int().positive().optional(),
  format: z.string().optional(),
});
export type MediaInfo = z.infer<typeof MediaInfoSchema>;

export const AssetKindSchema = z.enum(['video', 'audio', 'image', 'subtitle', 'data']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetSourceSchema = z.discriminatedUnion('kind', [
  /** A path on local storage (desktop) or an OPFS/browser handle reference. */
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  /** A content-addressed store reference, resolvable by the asset store. */
  z.object({ kind: z.literal('cas'), ref: z.string().min(1) }),
  /** A remote URL (imported from a provider). */
  z.object({ kind: z.literal('remote'), url: z.string().url() }),
]);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const AssetOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('import') }),
  z.object({ kind: z.literal('recorded') }),
  z.object({ kind: z.literal('generated'), provenance: GenerationProvenanceSchema }),
]);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

export const AssetSchema = z.object({
  id: AssetIdSchema,
  kind: AssetKindSchema,
  /** Human-facing name shown in the Media panel. */
  name: z.string().min(1).max(500),
  source: AssetSourceSchema,
  /** Probed media info; filled by the media indexer when available. */
  media: MediaInfoSchema.optional(),
  origin: AssetOriginSchema,
  /** Proxy asset used for fast preview/thumbnail work. */
  proxy: z
    .object({ assetId: AssetIdSchema, purpose: z.enum(['preview', 'thumbnail']) })
    .optional(),
  importedAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof AssetSchema>;
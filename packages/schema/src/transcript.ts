import { z } from 'zod';
import { AssetIdSchema, SegmentIdSchema, TranscriptIdSchema } from './ids.js';
import { GenerationProvenanceSchema } from './provenance.js';

/**
 * Transcripts are durable, editable project data: a time-aligned text
 * representation of a media asset, linked one-to-one to that asset.
 * ASR results, imported subtitles and manual corrections share this
 * shape; raw model output stays distinguishable from user corrections
 * through the source record.
 */
export const TranscriptSegmentSchema = z.object({
  id: SegmentIdSchema,
  startUs: z.number().int().nonnegative(),
  endUs: z.number().int().nonnegative(),
  text: z.string().max(5000),
  speaker: z.string().max(200).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asr'), provenance: GenerationProvenanceSchema }),
  z.object({ kind: z.literal('import'), format: z.string().optional() }),
  z.object({ kind: z.literal('manual') }),
]);
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;

export const TranscriptSchema = z.object({
  id: TranscriptIdSchema,
  assetId: AssetIdSchema,
  language: z.string().max(50).optional(),
  segments: z.array(TranscriptSegmentSchema).default([]),
  source: TranscriptSourceSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

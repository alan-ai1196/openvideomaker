import { z } from 'zod';
import { CharacterIdSchema, LineIdSchema, ScriptIdSchema } from './ids.js';

/**
 * Scripts are the script-first editing document: ordered speech lines
 * optionally linked to characters and voices, with optional timeline
 * placement. Editing a script never silently rewrites the timeline -
 * the user syncs lines to clips explicitly (one reviewable step).
 */
export const ScriptLineSchema = z.object({
  id: LineIdSchema,
  text: z.string().min(1).max(5000),
  /** Speaker character, when the line belongs to one. */
  characterId: CharacterIdSchema.optional(),
  /** Voice override for this line (otherwise the character's voice). */
  voiceId: z.string().max(200).optional(),
  /** Optional timeline placement; absent lines are placed by the sync command. */
  startUs: z.number().int().nonnegative().optional(),
  durationUs: z.number().int().positive().optional(),
  note: z.string().max(2000).optional(),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export const ScriptSchema = z.object({
  id: ScriptIdSchema,
  name: z.string().min(1).max(200),
  lines: z.array(ScriptLineSchema).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Script = z.infer<typeof ScriptSchema>;

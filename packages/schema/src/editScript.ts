import { z } from 'zod';
import { CaptionSegmentSchema, TextStyleSchema } from './clip.js';
import { TrackKindSchema } from './track.js';

/**
 * Agent editing vocabulary: plans are separate from mutation, and
 * scripts are RESTRICTED DECLARATIVE programs over the editing
 * domain - never arbitrary code. They compile to the same typed
 * operation layer the Studio uses, so agent edits are undoable,
 * replayable and reviewable like any other edit.
 */

export const EditEvidenceSchema = z.object({
  kind: z.enum(['transcript-range', 'time-range', 'clip', 'note']),
  reference: z.string().optional(),
  detail: z.string().max(2000).optional(),
});
export type EditEvidence = z.infer<typeof EditEvidenceSchema>;

export const EditPlanSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1).max(500),
  evidence: z.array(EditEvidenceSchema).default([]),
  constraints: z.array(z.string().max(500)).default([]),
  intendedChanges: z.array(z.string().max(500)).default([]),
  expectedOutcome: z.string().min(1).max(1000),
  affectedArea: z.string().max(200).optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

/** A step-local id (an existing entity) or a `$variable` bound by an earlier step. */
const target = z.string().min(1);

export const EditStepSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('track.create'),
    sequenceId: target,
    kind: TrackKindSchema,
    name: z.string().max(200).optional(),
    as: z.string().regex(/^\$[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  }),
  z.object({ op: z.literal('clip.remove'), clipId: target }),
  z.object({ op: z.literal('clip.move'), clipId: target, start: z.number().int().nonnegative() }),
  z.object({
    op: z.literal('clip.trim'),
    clipId: target,
    start: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    inPoint: z.number().int().nonnegative().optional(),
  }),
  z.object({
    op: z.literal('media.insert'),
    trackId: target,
    assetId: z.string().min(1),
    start: z.number().int().nonnegative(),
    duration: z.number().int().positive().optional(),
    inPoint: z.number().int().nonnegative().optional(),
    as: z.string().regex(/^\$[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  }),
  z.object({
    op: z.literal('text.insert'),
    trackId: target,
    start: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    content: z.string().min(1).max(5000),
    style: TextStyleSchema.partial().optional(),
    as: z.string().regex(/^\$[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  }),
  z.object({
    op: z.literal('caption.insert'),
    trackId: target,
    start: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    segments: z.array(CaptionSegmentSchema).min(1),
    as: z.string().regex(/^\$[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  }),
]);
export type EditStep = z.infer<typeof EditStepSchema>;

export const EditScriptSchema = z.object({
  schemaVersion: z.literal(1),
  goal: z.string().max(500).optional(),
  steps: z.array(EditStepSchema).min(1).max(500),
});
export type EditScript = z.infer<typeof EditScriptSchema>;

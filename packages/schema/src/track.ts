import { z } from 'zod';
import { TrackIdSchema } from './ids.js';
import { ClipSchema } from './clip.js';

export const TrackKindSchema = z.enum(['video', 'audio', 'text', 'caption', 'overlay']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

/**
 * A track owns an ordered, non-overlapping set of clips. Ordering and
 * overlap are enforced by the core invariant checker, not by this schema,
 * so partially-constructed in-memory states can still be represented.
 */
export const TrackSchema = z.object({
  id: TrackIdSchema,
  kind: TrackKindSchema,
  name: z.string().max(200),
  enabled: z.boolean().default(true),
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  clips: z.array(ClipSchema).default([]),
});
export type Track = z.infer<typeof TrackSchema>;
import { z } from 'zod';
import { MarkerIdSchema, SequenceIdSchema } from './ids.js';
import { TrackSchema } from './track.js';

export const MarkerSchema = z.object({
  id: MarkerIdSchema,
  /** Timeline position (µs). Markers may sit beyond the last clip. */
  time: z.number().int().nonnegative(),
  name: z.string().max(200),
  note: z.string().max(5000).default(''),
  color: z.string().optional(),
});
export type Marker = z.infer<typeof MarkerSchema>;

export const SequenceSchema = z.object({
  id: SequenceIdSchema,
  name: z.string().max(200),
  tracks: z.array(TrackSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  description: z.string().max(2000).optional(),
});
export type Sequence = z.infer<typeof SequenceSchema>;
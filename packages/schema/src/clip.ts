import { z } from 'zod';
import { AssetIdSchema, ClipIdSchema, EffectIdSchema, TrackIdSchema } from './ids.js';
import { GenerationProvenanceSchema } from './provenance.js';

/**
 * Transform of a clip inside its track frame. Position is expressed in
 * project pixels relative to the anchor point; scale/rotation apply around
 * the anchor. This is the same vocabulary used for classic NLE motion
 * controls, which keeps AI reframing results editable by hand.
 */
export const TransformSchema = z.object({
  positionX: z.number(),
  positionY: z.number(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
  /** Degrees, clockwise. */
  rotation: z.number(),
  /** Anchor in normalized coordinates: (0,0) top-left, (1,1) bottom-right. */
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
  flipH: z.boolean(),
  flipV: z.boolean(),
});
export type Transform = z.infer<typeof TransformSchema>;

export const DEFAULT_TRANSFORM: Transform = {
  positionX: 0,
  positionY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
  flipH: false,
  flipV: false,
};

/** Normalized crop, in fractions of the source frame (0..1). */
export const CropSchema = z.object({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  right: z.number().min(0).max(1),
  bottom: z.number().min(0).max(1),
});
export type Crop = z.infer<typeof CropSchema>;

export const ClipAudioSchema = z.object({
  /** Linear gain. 1 = unity. */
  gain: z.number().min(0).max(8),
  muted: z.boolean(),
  fadeInUs: z.number().int().nonnegative(),
  fadeOutUs: z.number().int().nonnegative(),
});
export type ClipAudio = z.infer<typeof ClipAudioSchema>;

export const DEFAULT_CLIP_AUDIO: ClipAudio = {
  gain: 1,
  muted: false,
  fadeInUs: 0,
  fadeOutUs: 0,
};

export const EasingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
export type Easing = z.infer<typeof EasingSchema>;

/** Keyframe position is relative to clip start (µs). */
export const KeyframeSchema = z.object({
  at: z.number().int().nonnegative(),
  value: z.unknown(),
  easing: EasingSchema,
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/**
 * A clip effect. type uses capability-style naming (e.g. video.adjust,
 * audio.denoise) so effects stay model-independent; concrete
 * implementations are resolved through the capability/runner layers.
 */
export const EffectSchema = z.object({
  id: EffectIdSchema,
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  keyframes: z.array(KeyframeSchema),
});
export type Effect = z.infer<typeof EffectSchema>;

export const TransitionKindSchema = z.enum(['fade', 'crossfade', 'wipe', 'slide', 'iris', 'custom']);
export type TransitionKind = z.infer<typeof TransitionKindSchema>;

export const TransitionSchema = z.object({
  kind: TransitionKindSchema,
  durationUs: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const CaptionSegmentSchema = z.object({
  text: z.string(),
  /** Segment timing is relative to the caption clip start (µs). */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  speaker: z.string().optional(),
});
export type CaptionSegment = z.infer<typeof CaptionSegmentSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  color: z.string(),
  background: z.string().optional(),
  bold: z.boolean(),
  italic: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  /** Position in normalized project coordinates (0..1). */
  positionX: z.number().min(0).max(1),
  positionY: z.number().min(0).max(1),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 64,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  positionX: 0.5,
  positionY: 0.5,
};

const clipBase = {
  id: ClipIdSchema,
  trackId: TrackIdSchema,
  /** Timeline position (absolute, µs). */
  start: z.number().int().nonnegative(),
  /** Timeline duration (µs). */
  duration: z.number().int().positive(),
  /** Playback speed multiplier. Source consumption = duration x speed. */
  speed: z.number().positive().default(1),
  enabled: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  transform: TransformSchema.default(() => ({ ...DEFAULT_TRANSFORM })),
  crop: CropSchema.nullable().default(null),
  audio: ClipAudioSchema.nullable().default(null),
  effects: z.array(EffectSchema).default([]),
  transitionIn: TransitionSchema.nullable().default(null),
  transitionOut: TransitionSchema.nullable().default(null),
  /** Linked audio/video companion clip, when media was split across tracks. */
  linkedClipId: ClipIdSchema.nullable().default(null),
  /** Provenance when the clip content was AI-generated. */
  provenance: GenerationProvenanceSchema.nullable().default(null),
};

export const ClipSchema = z.discriminatedUnion('kind', [
  z.object({
    ...clipBase,
    kind: z.literal('media'),
    assetId: AssetIdSchema,
    /** Source offset into the asset (µs). */
    inPoint: z.number().int().nonnegative().default(0),
  }),
  z.object({
    ...clipBase,
    kind: z.literal('text'),
    content: z.string(),
    style: TextStyleSchema.default(() => ({ ...DEFAULT_TEXT_STYLE })),
  }),
  z.object({
    ...clipBase,
    kind: z.literal('caption'),
    segments: z.array(CaptionSegmentSchema).default([]),
  }),
  z.object({
    ...clipBase,
    kind: z.literal('color'),
    color: z.string().default('#000000'),
  }),
]);

export type Clip = z.infer<typeof ClipSchema>;
export type MediaClip = Extract<Clip, { kind: 'media' }>;
export type TextClip = Extract<Clip, { kind: 'text' }>;
export type CaptionClip = Extract<Clip, { kind: 'caption' }>;
export type ColorClip = Extract<Clip, { kind: 'color' }>;
export type ClipKind = Clip['kind'];
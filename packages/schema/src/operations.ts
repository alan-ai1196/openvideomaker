import { z } from 'zod';
import {
  AssetIdSchema,
  CharacterIdSchema,
  ClipIdSchema,
  EffectIdSchema,
  MarkerIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
  SequenceIdSchema,
  TrackIdSchema,
} from './ids.js';
import {
  CaptionSegmentSchema,
  ClipAudioSchema,
  ClipSchema,
  CropSchema,
  EffectSchema,
  TextStyleSchema,
  TransformSchema,
  TransitionSchema,
} from './clip.js';
import { AssetSchema, AssetSourceSchema, MediaInfoSchema } from './media.js';
import { MarkerSchema } from './sequence.js';
import { TrackKindSchema } from './track.js';
import { CharacterSchema, ProjectSettingsSchema, VoiceConfigSchema } from './project.js';

/**
 * Every project mutation is an explicit typed operation. Human edits,
 * agent edits, scripts, MCP tools and the CLI all converge on this same
 * vocabulary - there is no second implementation of business logic.
 */
export const ActorSchema = z.object({
  kind: z.enum(['user', 'agent', 'script']),
  name: z.string().max(100).optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

// ---------------------------------------------------------------- params --

export const ProjectCreateParamsSchema = z.object({
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(200),
  settings: ProjectSettingsSchema.partial().optional(),
});
export type ProjectCreateParams = z.infer<typeof ProjectCreateParamsSchema>;

export const ProjectRenameParamsSchema = z.object({ name: z.string().min(1).max(200) });
export type ProjectRenameParams = z.infer<typeof ProjectRenameParamsSchema>;

export const ProjectSettingsParamsSchema = z.object({ settings: ProjectSettingsSchema.partial() });
export type ProjectSettingsParams = z.infer<typeof ProjectSettingsParamsSchema>;

export const SequenceCreateParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  name: z.string().max(200).optional(),
});
export type SequenceCreateParams = z.infer<typeof SequenceCreateParamsSchema>;

export const SequenceRemoveParamsSchema = z.object({ sequenceId: SequenceIdSchema });
export type SequenceRemoveParams = z.infer<typeof SequenceRemoveParamsSchema>;

export const SequenceRenameParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  name: z.string().min(1).max(200),
});
export type SequenceRenameParams = z.infer<typeof SequenceRenameParamsSchema>;

export const SequenceActivateParamsSchema = z.object({ sequenceId: SequenceIdSchema.nullable() });
export type SequenceActivateParams = z.infer<typeof SequenceActivateParamsSchema>;

export const TrackCreateParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  kind: TrackKindSchema,
  name: z.string().max(200).optional(),
  at: z.number().int().nonnegative().optional(),
});
export type TrackCreateParams = z.infer<typeof TrackCreateParamsSchema>;

export const TrackRemoveParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
});
export type TrackRemoveParams = z.infer<typeof TrackRemoveParamsSchema>;

export const TrackRenameParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  name: z.string().min(1).max(200),
});
export type TrackRenameParams = z.infer<typeof TrackRenameParamsSchema>;

export const TrackEnableParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  enabled: z.boolean(),
});
export type TrackEnableParams = z.infer<typeof TrackEnableParamsSchema>;

export const TrackLockParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  locked: z.boolean(),
});
export type TrackLockParams = z.infer<typeof TrackLockParamsSchema>;

export const TrackMuteParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  muted: z.boolean(),
});
export type TrackMuteParams = z.infer<typeof TrackMuteParamsSchema>;

export const ClipInsertParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  trackId: TrackIdSchema,
  clip: ClipSchema,
  /** Insertion index; defaults to the end of the track. */
  at: z.number().int().nonnegative().optional(),
});
export type ClipInsertParams = z.infer<typeof ClipInsertParamsSchema>;

export const ClipRemoveParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
});
export type ClipRemoveParams = z.infer<typeof ClipRemoveParamsSchema>;

export const ClipMoveParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  trackId: TrackIdSchema.optional(),
  start: z.number().int().nonnegative().optional(),
});
export type ClipMoveParams = z.infer<typeof ClipMoveParamsSchema>;

export const ClipTrimParamsSchema = z
  .object({
    sequenceId: SequenceIdSchema,
    clipId: ClipIdSchema,
    start: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    inPoint: z.number().int().nonnegative().optional(),
  })
  .refine((p) => p.start !== undefined || p.duration !== undefined || p.inPoint !== undefined, {
    message: 'trim requires at least one of start, duration, inPoint',
  });
export type ClipTrimParams = z.infer<typeof ClipTrimParamsSchema>;

export const ClipSplitParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  /** Split point relative to clip start (µs), strictly inside the clip. */
  at: z.number().int().positive(),
  leftClipId: ClipIdSchema,
  rightClipId: ClipIdSchema,
});
export type ClipSplitParams = z.infer<typeof ClipSplitParamsSchema>;

export const ClipTransformParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  transform: TransformSchema.partial(),
});
export type ClipTransformParams = z.infer<typeof ClipTransformParamsSchema>;

export const ClipOpacityParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  opacity: z.number().min(0).max(1),
});
export type ClipOpacityParams = z.infer<typeof ClipOpacityParamsSchema>;

export const ClipCropParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  crop: CropSchema.nullable(),
});
export type ClipCropParams = z.infer<typeof ClipCropParamsSchema>;

export const ClipSpeedParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  speed: z.number().positive(),
});
export type ClipSpeedParams = z.infer<typeof ClipSpeedParamsSchema>;

export const ClipEnableParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  enabled: z.boolean(),
});
export type ClipEnableParams = z.infer<typeof ClipEnableParamsSchema>;

export const ClipAudioParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  audio: ClipAudioSchema.partial().nullable(),
});
export type ClipAudioParams = z.infer<typeof ClipAudioParamsSchema>;

export const ClipAssetParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  assetId: AssetIdSchema,
  inPoint: z.number().int().nonnegative().optional(),
});
export type ClipAssetParams = z.infer<typeof ClipAssetParamsSchema>;

export const TextEditParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  content: z.string().optional(),
  style: TextStyleSchema.partial().optional(),
});
export type TextEditParams = z.infer<typeof TextEditParamsSchema>;

export const CaptionEditParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  segments: z.array(CaptionSegmentSchema),
});
export type CaptionEditParams = z.infer<typeof CaptionEditParamsSchema>;

export const EffectAddParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  effect: EffectSchema,
});
export type EffectAddParams = z.infer<typeof EffectAddParamsSchema>;

export const EffectRemoveParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  effectId: EffectIdSchema,
});
export type EffectRemoveParams = z.infer<typeof EffectRemoveParamsSchema>;

export const EffectUpdateParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  effectId: EffectIdSchema,
  params: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type EffectUpdateParams = z.infer<typeof EffectUpdateParamsSchema>;

export const TransitionSetParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  clipId: ClipIdSchema,
  in: TransitionSchema.nullable().optional(),
  out: TransitionSchema.nullable().optional(),
});
export type TransitionSetParams = z.infer<typeof TransitionSetParamsSchema>;

export const MarkerAddParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  marker: MarkerSchema,
});
export type MarkerAddParams = z.infer<typeof MarkerAddParamsSchema>;

export const MarkerRemoveParamsSchema = z.object({
  sequenceId: SequenceIdSchema,
  markerId: MarkerIdSchema,
});
export type MarkerRemoveParams = z.infer<typeof MarkerRemoveParamsSchema>;

export const AssetImportParamsSchema = z.object({ asset: AssetSchema });
export type AssetImportParams = z.infer<typeof AssetImportParamsSchema>;

export const AssetUpdateParamsSchema = z.object({
  assetId: AssetIdSchema,
  name: z.string().min(1).max(500).optional(),
  media: MediaInfoSchema.optional(),
});
export type AssetUpdateParams = z.infer<typeof AssetUpdateParamsSchema>;

export const AssetRemoveParamsSchema = z.object({ assetId: AssetIdSchema });
export type AssetRemoveParams = z.infer<typeof AssetRemoveParamsSchema>;

export const AssetReplaceParamsSchema = z.object({
  assetId: AssetIdSchema,
  asset: AssetSchema,
});
export type AssetReplaceParams = z.infer<typeof AssetReplaceParamsSchema>;

export const CharacterCreateParamsSchema = z.object({ character: CharacterSchema });
export type CharacterCreateParams = z.infer<typeof CharacterCreateParamsSchema>;

export const CharacterPatchSchema = CharacterSchema.omit({ id: true, createdAt: true }).partial();
export type CharacterPatch = z.infer<typeof CharacterPatchSchema>;

export const CharacterUpdateParamsSchema = z.object({
  characterId: CharacterIdSchema,
  patch: CharacterPatchSchema,
});
export type CharacterUpdateParams = z.infer<typeof CharacterUpdateParamsSchema>;

export const CharacterRemoveParamsSchema = z.object({ characterId: CharacterIdSchema });
export type CharacterRemoveParams = z.infer<typeof CharacterRemoveParamsSchema>;

export const VoiceChangeParamsSchema = z.object({
  characterId: CharacterIdSchema,
  voice: VoiceConfigSchema,
});
export type VoiceChangeParams = z.infer<typeof VoiceChangeParamsSchema>;

export const GenerationCreateParamsSchema = z.object({ asset: AssetSchema });
export type GenerationCreateParams = z.infer<typeof GenerationCreateParamsSchema>;

export const GenerationRegenerateParamsSchema = z.object({
  assetId: AssetIdSchema,
  newAssetId: AssetIdSchema,
  source: AssetSourceSchema,
  media: MediaInfoSchema.optional(),
});
export type GenerationRegenerateParams = z.infer<typeof GenerationRegenerateParamsSchema>;

// ------------------------------------------------------------ operation --

const envelope = {
  opId: OperationIdSchema,
  at: z.iso.datetime(),
  actor: ActorSchema,
};

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('project.create'), params: ProjectCreateParamsSchema }),
  z.object({ ...envelope, type: z.literal('project.rename'), params: ProjectRenameParamsSchema }),
  z.object({ ...envelope, type: z.literal('project.settings'), params: ProjectSettingsParamsSchema }),
  z.object({ ...envelope, type: z.literal('sequence.create'), params: SequenceCreateParamsSchema }),
  z.object({ ...envelope, type: z.literal('sequence.remove'), params: SequenceRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('sequence.rename'), params: SequenceRenameParamsSchema }),
  z.object({ ...envelope, type: z.literal('sequence.activate'), params: SequenceActivateParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.create'), params: TrackCreateParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.remove'), params: TrackRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.rename'), params: TrackRenameParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.enable'), params: TrackEnableParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.lock'), params: TrackLockParamsSchema }),
  z.object({ ...envelope, type: z.literal('track.mute'), params: TrackMuteParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.insert'), params: ClipInsertParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.remove'), params: ClipRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.move'), params: ClipMoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.trim'), params: ClipTrimParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.split'), params: ClipSplitParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.transform'), params: ClipTransformParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.opacity'), params: ClipOpacityParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.crop'), params: ClipCropParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.speed'), params: ClipSpeedParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.enable'), params: ClipEnableParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.audio'), params: ClipAudioParamsSchema }),
  z.object({ ...envelope, type: z.literal('clip.asset'), params: ClipAssetParamsSchema }),
  z.object({ ...envelope, type: z.literal('text.edit'), params: TextEditParamsSchema }),
  z.object({ ...envelope, type: z.literal('caption.edit'), params: CaptionEditParamsSchema }),
  z.object({ ...envelope, type: z.literal('effect.add'), params: EffectAddParamsSchema }),
  z.object({ ...envelope, type: z.literal('effect.remove'), params: EffectRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('effect.update'), params: EffectUpdateParamsSchema }),
  z.object({ ...envelope, type: z.literal('transition.set'), params: TransitionSetParamsSchema }),
  z.object({ ...envelope, type: z.literal('marker.add'), params: MarkerAddParamsSchema }),
  z.object({ ...envelope, type: z.literal('marker.remove'), params: MarkerRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('asset.import'), params: AssetImportParamsSchema }),
  z.object({ ...envelope, type: z.literal('asset.update'), params: AssetUpdateParamsSchema }),
  z.object({ ...envelope, type: z.literal('asset.remove'), params: AssetRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('asset.replace'), params: AssetReplaceParamsSchema }),
  z.object({ ...envelope, type: z.literal('character.create'), params: CharacterCreateParamsSchema }),
  z.object({ ...envelope, type: z.literal('character.update'), params: CharacterUpdateParamsSchema }),
  z.object({ ...envelope, type: z.literal('character.remove'), params: CharacterRemoveParamsSchema }),
  z.object({ ...envelope, type: z.literal('voice.change'), params: VoiceChangeParamsSchema }),
  z.object({ ...envelope, type: z.literal('generation.create'), params: GenerationCreateParamsSchema }),
  z.object({ ...envelope, type: z.literal('generation.regenerate'), params: GenerationRegenerateParamsSchema }),
]);

export const OPERATION_TYPES = [
  'project.create',
  'project.rename',
  'project.settings',
  'sequence.create',
  'sequence.remove',
  'sequence.rename',
  'sequence.activate',
  'track.create',
  'track.remove',
  'track.rename',
  'track.enable',
  'track.lock',
  'track.mute',
  'clip.insert',
  'clip.remove',
  'clip.move',
  'clip.trim',
  'clip.split',
  'clip.transform',
  'clip.opacity',
  'clip.crop',
  'clip.speed',
  'clip.enable',
  'clip.audio',
  'clip.asset',
  'text.edit',
  'caption.edit',
  'effect.add',
  'effect.remove',
  'effect.update',
  'transition.set',
  'marker.add',
  'marker.remove',
  'asset.import',
  'asset.update',
  'asset.remove',
  'asset.replace',
  'character.create',
  'character.update',
  'character.remove',
  'voice.change',
  'generation.create',
  'generation.regenerate',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export type Operation = z.infer<typeof OperationSchema>;

type DistributiveRaw<T> = T extends { type: infer Ty; params: infer P } ? { type: Ty; params: P } : never;
/** An operation without its envelope (opId/at/actor) - filled in by the session. */
export type RawOperation = DistributiveRaw<Operation>;
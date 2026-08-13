import { z } from 'zod';
import { AssetIdSchema, CharacterIdSchema, ProjectIdSchema, ScriptIdSchema, SequenceIdSchema, TranscriptIdSchema } from './ids.js';
import { AssetSchema } from './media.js';
import { SequenceSchema } from './sequence.js';
import { TranscriptSchema } from './transcript.js';
import { ScriptSchema } from './script.js';
import { COMMON_FPS, RationalFpsSchema } from './time.js';

export const ProjectSettingsSchema = z.object({
  /** Composition frame size in project pixels. */
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  /** Project timebase (rational fps). */
  fps: RationalFpsSchema.default(() => ({ ...COMMON_FPS.FPS_30 })),
  sampleRate: z.number().int().positive().default(48000),
  audioChannels: z.number().int().min(1).max(8).default(2),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const VoiceConsentSchema = z.object({
  /** Whether consent for voice use/cloning is recorded. */
  hasConsent: z.boolean(),
  note: z.string().max(2000).optional(),
});
export type VoiceConsent = z.infer<typeof VoiceConsentSchema>;

export const VoiceConfigSchema = z.object({
  /** TTS provider id, e.g. a registry model id or a system voice. */
  provider: z.string().min(1),
  modelId: z.string().optional(),
  /** Provider-specific voice/profile identifier. */
  voiceId: z.string().optional(),
  /** Reference audio used for cloning, when applicable. */
  sampleAudioAssetId: AssetIdSchema.optional(),
  consent: VoiceConsentSchema,
});
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

export const CharacterDefaultsSchema = z.object({
  realism: z.number().min(0).max(1).default(0.6),
  gesture: z.number().min(0).max(1).default(0.3),
  headMotion: z.number().min(0).max(1).default(0.3),
  emotion: z.string().max(100).optional(),
  preferredCapability: z.string().optional(),
  preferredModelId: z.string().optional(),
});
export type CharacterDefaults = z.infer<typeof CharacterDefaultsSchema>;

/**
 * A persistent, reusable library entity: identity + voice + performance
 * defaults. Create a character once, reuse it in many scenes.
 */
export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  avatar: z.object({
    referenceImageAssetIds: z.array(AssetIdSchema).default([]),
    referenceVideoAssetId: AssetIdSchema.optional(),
    identityNote: z.string().max(2000).optional(),
  }),
  voice: VoiceConfigSchema,
  defaults: CharacterDefaultsSchema.default(() => ({ realism: 0.6, gesture: 0.3, headMotion: 0.3 })),
  createdAt: z.iso.datetime(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const ProjectSchema = z.object({
  /** Durable format version; bumped only by explicit migrations. */
  formatVersion: z.literal(1),
  id: ProjectIdSchema,
  name: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: ProjectSettingsSchema,
  assets: z.record(z.string(), AssetSchema).default({}),
  characters: z.record(z.string(), CharacterSchema).default({}),
  sequences: z.record(z.string(), SequenceSchema).default({}),
  transcripts: z.record(z.string(), TranscriptSchema).default({}),
  /** assetId -> transcriptId linkage; at most one transcript per asset. */
  assetTranscripts: z.record(z.string(), TranscriptIdSchema).default({}),
  scripts: z.record(z.string(), ScriptSchema).default({}),
  activeSequenceId: SequenceIdSchema.nullable().default(null),
});
export type Project = z.infer<typeof ProjectSchema>;
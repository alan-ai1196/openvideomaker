import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * All durable identifiers in OpenVideoMaker are opaque, prefixed strings.
 * The prefix encodes the entity kind so identifiers are self-describing in
 * logs, project files, and agent tool calls, and remain stable across
 * renames/reimports. The body is UUID v4-derived (32 hex chars).
 */
export const ID_PREFIXES = ['proj', 'asset', 'clip', 'trk', 'seq', 'char', 'op', 'tx', 'mkr', 'fx'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

function brandedId<P extends string>(prefix: P) {
  return z
    .string()
    .regex(new RegExp('^' + prefix + '_[a-z0-9]{16,}$'), 'invalid ' + prefix + ' id')
    .brand<P>();
}

export const ProjectIdSchema = brandedId('proj');
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const AssetIdSchema = brandedId('asset');
export type AssetId = z.infer<typeof AssetIdSchema>;

export const ClipIdSchema = brandedId('clip');
export type ClipId = z.infer<typeof ClipIdSchema>;

export const TrackIdSchema = brandedId('trk');
export type TrackId = z.infer<typeof TrackIdSchema>;

export const SequenceIdSchema = brandedId('seq');
export type SequenceId = z.infer<typeof SequenceIdSchema>;

export const CharacterIdSchema = brandedId('char');
export type CharacterId = z.infer<typeof CharacterIdSchema>;

export const OperationIdSchema = brandedId('op');
export type OperationId = z.infer<typeof OperationIdSchema>;

export const TransactionIdSchema = brandedId('tx');
export type TransactionId = z.infer<typeof TransactionIdSchema>;

export const MarkerIdSchema = brandedId('mkr');
export type MarkerId = z.infer<typeof MarkerIdSchema>;

export const EffectIdSchema = brandedId('fx');
export type EffectId = z.infer<typeof EffectIdSchema>;

/** Generate a fresh id with the given entity prefix. */
export function newId<P extends IdPrefix>(prefix: P): `${P}_${string}` {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export const newProjectId = (): ProjectId => newId('proj') as ProjectId;
export const newAssetId = (): AssetId => newId('asset') as AssetId;
export const newClipId = (): ClipId => newId('clip') as ClipId;
export const newTrackId = (): TrackId => newId('trk') as TrackId;
export const newSequenceId = (): SequenceId => newId('seq') as SequenceId;
export const newCharacterId = (): CharacterId => newId('char') as CharacterId;
export const newOperationId = (): OperationId => newId('op') as OperationId;
export const newTransactionId = (): TransactionId => newId('tx') as TransactionId;
export const newMarkerId = (): MarkerId => newId('mkr') as MarkerId;
export const newEffectId = (): EffectId => newId('fx') as EffectId;

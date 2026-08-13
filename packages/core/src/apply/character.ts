import type { CharacterPatch } from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type { CharacterCreateParams, CharacterRemoveParams, CharacterUpdateParams } from '@openvideomaker/schema';

export const applyCharacterCreate: ApplyFn<CharacterCreateParams> = (project, params, ctx) => {
  if (project.characters[params.character.id]) {
    throw new OperationError('op.validation', 'character id already used: ' + params.character.id);
  }
  project.characters[params.character.id] = params.character;
  project.updatedAt = ctx.now;
};

export function mergeCharacterPatch<T extends CharacterPatch>(patch: T): T {
  return patch;
}

export const applyCharacterUpdate: ApplyFn<CharacterUpdateParams> = (project, params, ctx) => {
  const character = project.characters[params.characterId];
  if (!character) throw new OperationError('op.not-found', 'character not found: ' + params.characterId);
  const patch = params.patch;
  if (patch.name !== undefined) character.name = patch.name;
  if (patch.description !== undefined) character.description = patch.description;
  if (patch.avatar !== undefined) character.avatar = { ...character.avatar, ...patch.avatar };
  if (patch.voice !== undefined) character.voice = patch.voice;
  if (patch.defaults !== undefined) character.defaults = { ...character.defaults, ...patch.defaults };
  project.updatedAt = ctx.now;
};

export const applyCharacterRemove: ApplyFn<CharacterRemoveParams> = (project, params, ctx) => {
  if (!project.characters[params.characterId]) {
    throw new OperationError('op.not-found', 'character not found: ' + params.characterId);
  }
  delete project.characters[params.characterId];
  project.updatedAt = ctx.now;
};
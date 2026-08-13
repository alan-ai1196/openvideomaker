import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type { VoiceChangeParams } from '@openvideomaker/schema';

export const applyVoiceChange: ApplyFn<VoiceChangeParams> = (project, params, ctx) => {
  const character = project.characters[params.characterId];
  if (!character) throw new OperationError('op.not-found', 'character not found: ' + params.characterId);
  character.voice = params.voice;
  project.updatedAt = ctx.now;
};
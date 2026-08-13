import { OperationError } from '../errors.js';
import { findClip } from '../find.js';
import type { ApplyFn } from '../types.js';
import type {
  EffectAddParams,
  EffectRemoveParams,
  EffectUpdateParams,
  TransitionSetParams,
} from '@openvideomaker/schema';

export const applyEffectAdd: ApplyFn<EffectAddParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (loc.clip.effects.some((fx) => fx.id === params.effect.id)) {
    throw new OperationError('op.validation', 'effect id already used on clip: ' + params.effect.id);
  }
  loc.clip.effects.push(params.effect);
  project.updatedAt = ctx.now;
};

export const applyEffectRemove: ApplyFn<EffectRemoveParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  const before = loc.clip.effects.length;
  loc.clip.effects = loc.clip.effects.filter((fx) => fx.id !== params.effectId);
  if (loc.clip.effects.length === before) {
    throw new OperationError('op.not-found', 'effect not found: ' + params.effectId);
  }
  project.updatedAt = ctx.now;
};

export const applyEffectUpdate: ApplyFn<EffectUpdateParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  const fx = loc.clip.effects.find((e) => e.id === params.effectId);
  if (!fx) throw new OperationError('op.not-found', 'effect not found: ' + params.effectId);
  if (params.params !== undefined) fx.params = params.params;
  if (params.enabled !== undefined) fx.enabled = params.enabled;
  project.updatedAt = ctx.now;
};

export const applyTransitionSet: ApplyFn<TransitionSetParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (params.in !== undefined) {
    if (params.in && params.in.durationUs > loc.clip.duration) {
      throw new OperationError('op.validation', 'transition in exceeds clip duration');
    }
    loc.clip.transitionIn = params.in;
  }
  if (params.out !== undefined) {
    if (params.out && params.out.durationUs > loc.clip.duration) {
      throw new OperationError('op.validation', 'transition out exceeds clip duration');
    }
    loc.clip.transitionOut = params.out;
  }
  project.updatedAt = ctx.now;
};
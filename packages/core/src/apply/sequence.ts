import type { Project, SequenceId } from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type {
  SequenceActivateParams,
  SequenceCreateParams,
  SequenceRemoveParams,
  SequenceRenameParams,
} from '@openvideomaker/schema';

export const applySequenceCreate: ApplyFn<SequenceCreateParams> = (project, params, ctx) => {
  if (project.sequences[params.sequenceId]) {
    throw new OperationError('op.validation', 'sequence already exists: ' + params.sequenceId);
  }
  const count = Object.keys(project.sequences).length + 1;
  project.sequences[params.sequenceId] = {
    id: params.sequenceId,
    name: params.name ?? 'Sequence ' + count,
    tracks: [],
    markers: [],
  };
  if (!project.activeSequenceId) project.activeSequenceId = params.sequenceId;
  project.updatedAt = ctx.now;
};

export const applySequenceRemove: ApplyFn<SequenceRemoveParams> = (project, params, ctx) => {
  if (!project.sequences[params.sequenceId]) {
    throw new OperationError('op.not-found', 'sequence not found: ' + params.sequenceId);
  }
  if (Object.keys(project.sequences).length <= 1) {
    throw new OperationError('op.validation', 'cannot remove the only sequence');
  }
  delete project.sequences[params.sequenceId];
  if (project.activeSequenceId === params.sequenceId) project.activeSequenceId = null;
  project.updatedAt = ctx.now;
};

export const applySequenceRename: ApplyFn<SequenceRenameParams> = (project, params, ctx) => {
  const sequence = project.sequences[params.sequenceId];
  if (!sequence) throw new OperationError('op.not-found', 'sequence not found: ' + params.sequenceId);
  sequence.name = params.name;
  project.updatedAt = ctx.now;
};

export const applySequenceActivate: ApplyFn<SequenceActivateParams> = (project, params, ctx) => {
  if (params.sequenceId !== null && !project.sequences[params.sequenceId]) {
    throw new OperationError('op.not-found', 'sequence not found: ' + String(params.sequenceId));
  }
  project.activeSequenceId = params.sequenceId as SequenceId | null;
  project.updatedAt = ctx.now;
};
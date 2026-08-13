import { OperationError } from '../errors.js';
import { findSequence } from '../find.js';
import type { ApplyFn } from '../types.js';
import type { MarkerAddParams, MarkerRemoveParams } from '@openvideomaker/schema';

export const applyMarkerAdd: ApplyFn<MarkerAddParams> = (project, params, ctx) => {
  const sequence = findSequence(project, params.sequenceId);
  if (!sequence) throw new OperationError('op.not-found', 'sequence not found: ' + params.sequenceId);
  if (sequence.markers.some((m) => m.id === params.marker.id)) {
    throw new OperationError('op.validation', 'marker id already used: ' + params.marker.id);
  }
  sequence.markers.push(params.marker);
  sequence.markers.sort((a, b) => a.time - b.time);
  project.updatedAt = ctx.now;
};

export const applyMarkerRemove: ApplyFn<MarkerRemoveParams> = (project, params, ctx) => {
  const sequence = findSequence(project, params.sequenceId);
  if (!sequence) throw new OperationError('op.not-found', 'sequence not found: ' + params.sequenceId);
  const before = sequence.markers.length;
  sequence.markers = sequence.markers.filter((m) => m.id !== params.markerId);
  if (sequence.markers.length === before) {
    throw new OperationError('op.not-found', 'marker not found: ' + params.markerId);
  }
  project.updatedAt = ctx.now;
};
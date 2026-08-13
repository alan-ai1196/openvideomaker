import { OperationError } from '../errors.js';
import { findClip } from '../find.js';
import type { ApplyFn } from '../types.js';
import type { CaptionEditParams, TextEditParams } from '@openvideomaker/schema';

export const applyTextEdit: ApplyFn<TextEditParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (loc.clip.kind !== 'text') {
    throw new OperationError('op.validation', 'text.edit only applies to text clips');
  }
  if (params.content !== undefined) loc.clip.content = params.content;
  if (params.style !== undefined) loc.clip.style = { ...loc.clip.style, ...params.style };
  project.updatedAt = ctx.now;
};

export const applyCaptionEdit: ApplyFn<CaptionEditParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (loc.clip.kind !== 'caption') {
    throw new OperationError('op.validation', 'caption.edit only applies to caption clips');
  }
  const sorted = [...params.segments].sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    if (seg.start < 0 || seg.end > loc.clip.duration || seg.end <= seg.start) {
      throw new OperationError('op.validation', 'caption segment outside clip bounds or empty');
    }
  }
  loc.clip.segments = sorted;
  project.updatedAt = ctx.now;
};
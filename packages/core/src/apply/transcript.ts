import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type {
  TranscriptCreateParams,
  TranscriptRemoveParams,
  TranscriptSetLanguageParams,
  TranscriptSetSegmentsParams,
  TranscriptSetSegmentTextParams,
} from '@openvideomaker/schema';

export const applyTranscriptCreate: ApplyFn<TranscriptCreateParams> = (project, params, ctx) => {
  const transcript = params.transcript;
  if (project.transcripts[transcript.id]) {
    throw new OperationError('op.validation', 'transcript id already used: ' + transcript.id);
  }
  if (project.assetTranscripts[transcript.assetId]) {
    throw new OperationError('op.validation', 'asset already has a transcript: ' + transcript.assetId);
  }
  project.transcripts[transcript.id] = transcript;
  project.assetTranscripts[transcript.assetId] = transcript.id;
  project.updatedAt = ctx.now;
};

export const applyTranscriptSetSegments: ApplyFn<TranscriptSetSegmentsParams> = (project, params, ctx) => {
  const transcript = project.transcripts[params.transcriptId];
  if (!transcript) throw new OperationError('op.not-found', 'transcript not found: ' + params.transcriptId);
  transcript.segments = params.segments;
  transcript.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyTranscriptSetSegmentText: ApplyFn<TranscriptSetSegmentTextParams> = (project, params, ctx) => {
  const transcript = project.transcripts[params.transcriptId];
  if (!transcript) throw new OperationError('op.not-found', 'transcript not found: ' + params.transcriptId);
  const segment = transcript.segments.find((s) => s.id === params.segmentId);
  if (!segment) throw new OperationError('op.not-found', 'segment not found: ' + params.segmentId);
  segment.text = params.text;
  transcript.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyTranscriptSetLanguage: ApplyFn<TranscriptSetLanguageParams> = (project, params, ctx) => {
  const transcript = project.transcripts[params.transcriptId];
  if (!transcript) throw new OperationError('op.not-found', 'transcript not found: ' + params.transcriptId);
  transcript.language = params.language;
  transcript.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyTranscriptRemove: ApplyFn<TranscriptRemoveParams> = (project, params, ctx) => {
  const transcript = project.transcripts[params.transcriptId];
  if (!transcript) throw new OperationError('op.not-found', 'transcript not found: ' + params.transcriptId);
  delete project.transcripts[params.transcriptId];
  if (project.assetTranscripts[transcript.assetId] === params.transcriptId) {
    delete project.assetTranscripts[transcript.assetId];
  }
  project.updatedAt = ctx.now;
};

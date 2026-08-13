import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type { GenerationCreateParams, GenerationRegenerateParams } from '@openvideomaker/schema';

export const applyGenerationCreate: ApplyFn<GenerationCreateParams> = (project, params, ctx) => {
  if (params.asset.origin.kind !== 'generated') {
    throw new OperationError('op.validation', 'generation.create requires an asset with a generated origin');
  }
  if (project.assets[params.asset.id]) {
    throw new OperationError('op.validation', 'asset id already used: ' + params.asset.id);
  }
  project.assets[params.asset.id] = params.asset;
  project.updatedAt = ctx.now;
};

export const applyGenerationRegenerate: ApplyFn<GenerationRegenerateParams> = (project, params, ctx) => {
  const previous = project.assets[params.assetId];
  if (!previous) throw new OperationError('op.not-found', 'asset not found: ' + params.assetId);
  if (previous.origin.kind !== 'generated') {
    throw new OperationError('op.validation', 'only generated assets can be regenerated');
  }
  if (project.assets[params.newAssetId]) {
    throw new OperationError('op.validation', 'asset id already used: ' + params.newAssetId);
  }
  project.assets[params.newAssetId] = {
    ...previous,
    id: params.newAssetId,
    source: params.source,
    media: params.media ?? previous.media,
    origin: {
      kind: 'generated',
      provenance: {
        ...previous.origin.provenance,
        regeneratedFrom: params.assetId,
        generatedAt: ctx.now,
      },
    },
  };
  project.updatedAt = ctx.now;
};
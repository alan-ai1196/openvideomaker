import type { AssetId, Project } from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import { allClips } from '../find.js';
import type { ApplyFn } from '../types.js';
import type { AssetImportParams, AssetRemoveParams, AssetReplaceParams, AssetUpdateParams } from '@openvideomaker/schema';

export const applyAssetImport: ApplyFn<AssetImportParams> = (project, params, ctx) => {
  if (project.assets[params.asset.id]) {
    throw new OperationError('op.validation', 'asset id already used: ' + params.asset.id);
  }
  project.assets[params.asset.id] = params.asset;
  project.updatedAt = ctx.now;
};

export const applyAssetUpdate: ApplyFn<AssetUpdateParams> = (project, params, ctx) => {
  const asset = project.assets[params.assetId];
  if (!asset) throw new OperationError('op.not-found', 'asset not found: ' + params.assetId);
  if (params.name !== undefined) asset.name = params.name;
  if (params.media !== undefined) asset.media = params.media;
  project.updatedAt = ctx.now;
};

function referencingClips(project: Project, assetId: AssetId): string[] {
  const refs: string[] = [];
  for (const { sequence, track, clip } of allClips(project)) {
    if (clip.kind === 'media' && clip.assetId === assetId) {
      refs.push(sequence.id + '/' + track.id + '/' + clip.id);
    }
  }
  return refs;
}

export const applyAssetRemove: ApplyFn<AssetRemoveParams> = (project, params, ctx) => {
  const asset = project.assets[params.assetId];
  if (!asset) throw new OperationError('op.not-found', 'asset not found: ' + params.assetId);
  const clipRefs = referencingClips(project, params.assetId);
  const characterRefs = Object.values(project.characters)
    .filter(
      (c) =>
        c.avatar.referenceImageAssetIds.includes(params.assetId) ||
        c.avatar.referenceVideoAssetId === params.assetId ||
        c.voice.sampleAudioAssetId === params.assetId,
    )
    .map((c) => c.id);
  const proxyRefs = Object.values(project.assets)
    .filter((a) => a.proxy?.assetId === params.assetId)
    .map((a) => a.id);
  if (clipRefs.length || characterRefs.length || proxyRefs.length) {
    throw new OperationError('op.validation', 'asset is still referenced and cannot be removed', undefined, {
      clipRefs,
      characterRefs,
      proxyRefs,
    });
  }
  delete project.assets[params.assetId];
  project.updatedAt = ctx.now;
};

export const applyAssetReplace: ApplyFn<AssetReplaceParams> = (project, params, ctx) => {
  if (!project.assets[params.assetId]) {
    throw new OperationError('op.not-found', 'asset not found: ' + params.assetId);
  }
  if (params.asset.id !== params.assetId) {
    throw new OperationError('op.validation', 'replacement asset id must match the replaced asset id');
  }
  project.assets[params.assetId] = params.asset;
  project.updatedAt = ctx.now;
};
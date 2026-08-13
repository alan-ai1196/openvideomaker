import type { ModelSource } from '@openvideomaker/registry';
import type { SourceProfile } from './types.js';

/**
 * Resolve a model file to ordered candidate URLs per source and profile.
 * Both hubs are first-class; mirrors come from configuration (the HF
 * ecosystem's HF_ENDPOINT variable), never from hardcoded lists.
 */
export function candidateUrls(source: ModelSource, filePath: string, profile: SourceProfile, env: NodeJS.ProcessEnv = process.env): string[] {
  if (source.kind === 'hf') {
    const revision = source.revision ?? 'main';
    const endpoint = (env.HF_ENDPOINT ?? 'https://huggingface.co').replace(/\/$/, '');
    const canonical = 'https://huggingface.co/' + source.repo + '/resolve/' + revision + '/' + filePath;
    const mirrored = endpoint + '/' + source.repo + '/resolve/' + revision + '/' + filePath;
    if (profile === 'mainland-china') {
      return mirrored === canonical ? [canonical] : [mirrored, canonical];
    }
    return [canonical];
  }
  if (source.kind === 'modelscope') {
    const revision = source.revision ?? 'master';
    return [
      'https://modelscope.cn/api/v1/models/' + source.modelId + '/repo?Revision=' + revision + '&FilePath=' + encodeURIComponent(filePath),
    ];
  }
  if (source.kind === 'http') {
    const url = source.files[filePath];
    return url ? [url] : [];
  }
  return [];
}

/** Order sources for a file according to the profile. */
export function orderSources(sources: ModelSource[], profile: SourceProfile): ModelSource[] {
  if (profile === 'mainland-china') {
    return [...sources].sort((a, b) => {
      const rank = (s: ModelSource): number => (s.kind === 'modelscope' ? 0 : s.kind === 'hf' ? 1 : 2);
      return rank(a) - rank(b);
    });
  }
  if (profile === 'global') {
    return [...sources].sort((a, b) => {
      const rank = (s: ModelSource): number => (s.kind === 'hf' ? 0 : s.kind === 'modelscope' ? 1 : 2);
      return rank(a) - rank(b);
    });
  }
  return sources;
}

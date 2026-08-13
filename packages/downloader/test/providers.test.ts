import { describe, expect, it } from 'vitest';
import { candidateUrls, orderSources } from '@openvideomaker/downloader';
import type { ModelSource } from '@openvideomaker/registry';

describe('candidateUrls', () => {
  it('resolves hf urls with pinned revisions', () => {
    const source: ModelSource = { kind: 'hf', repo: 'openai/whisper-large-v3', revision: 'abc123' };
    expect(candidateUrls(source, 'model.safetensors', 'auto', {})).toEqual([
      'https://huggingface.co/openai/whisper-large-v3/resolve/abc123/model.safetensors',
    ]);
  });

  it('honors a configured HF_ENDPOINT mirror for mainland-china', () => {
    const source: ModelSource = { kind: 'hf', repo: 'openai/whisper-large-v3' };
    const urls = candidateUrls(source, 'model.safetensors', 'mainland-china', { HF_ENDPOINT: 'https://hf-mirror.com' });
    expect(urls).toEqual([
      'https://hf-mirror.com/openai/whisper-large-v3/resolve/main/model.safetensors',
      'https://huggingface.co/openai/whisper-large-v3/resolve/main/model.safetensors',
    ]);
  });

  it('resolves modelscope urls first-class', () => {
    const source: ModelSource = { kind: 'modelscope', modelId: 'iic/demo' };
    expect(candidateUrls(source, 'model.pth', 'auto', {})[0]).toContain('modelscope.cn/api/v1/models/iic/demo/repo');
    expect(candidateUrls(source, 'model.pth', 'auto', {})[0]).toContain('FilePath=model.pth');
  });

  it('resolves explicit http mirrors', () => {
    const source: ModelSource = { kind: 'http', baseUrl: 'https://example.com', files: { 'a.bin': 'https://example.com/a.bin' } };
    expect(candidateUrls(source, 'a.bin', 'auto', {})).toEqual(['https://example.com/a.bin']);
    expect(candidateUrls(source, 'missing.bin', 'auto', {})).toEqual([]);
  });
});

describe('orderSources', () => {
  const hf: ModelSource = { kind: 'hf', repo: 'x/y' };
  const ms: ModelSource = { kind: 'modelscope', modelId: 'x/y' };
  const http: ModelSource = { kind: 'http', baseUrl: 'https://e.com', files: {} };

  it('prefers hf globally and modelscope in mainland-china', () => {
    expect(orderSources([ms, http, hf], 'global')[0]?.kind).toBe('hf');
    expect(orderSources([hf, http, ms], 'mainland-china')[0]?.kind).toBe('modelscope');
  });
});

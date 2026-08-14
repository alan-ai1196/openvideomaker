import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORY_LABELS, CAPABILITIES, Registry } from '@openvideomaker/registry';
import { generateModelDocs, loadRegistryFromDir } from '@openvideomaker/registry/node';
import { resolve } from 'node:path';

describe('registry data', () => {
  const registry = loadRegistryFromDir(resolve('src/data'));

  it('loads every bundled entry without errors', () => {
    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(9);
  });

  it('has unique ids and valid capability references', () => {
    const ids = registry.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares trust states honestly: only entries with real execution evidence are verified', () => {
    const verified = registry.entries.filter((e) => e.verification.trust === 'verified');
    expect(verified.map((e) => e.id)).toEqual(['hf/hexgrad/Kokoro-82M', 'hf/bytedance/latentsync-1.5', 'ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch', 'hf/openai/whisper-large-v3']);
    for (const entry of verified) {
      expect(entry.verification.verifiedAt).toBeTruthy();
      expect(entry.verification.evidence).toMatch(/Executed/);
    }
    for (const entry of registry.entries.filter((e) => e.verification.trust !== 'verified')) {
      expect(entry.verification.trust).toBe('unverified');
    }
  });

  it('queries by capability and category', () => {
    expect(registry.byCapability('avatar.lip_sync')).toHaveLength(2);
    expect(registry.byCapability('audio.tts').map((e) => e.id)).toEqual(['hf/hexgrad/Kokoro-82M']);
    const speech = registry.search({ category: 'speech' });
    expect(speech.length).toBeGreaterThanOrEqual(3);
  });

  it('searches across names and ids', () => {
    expect(registry.search({ query: 'whisper' })[0]?.id).toBe('hf/openai/whisper-large-v3');
    expect(registry.search({ query: 'flux' })).toHaveLength(1);
  });

  it('exposes a coherent capability catalog', () => {
    expect(CAPABILITIES.length).toBeGreaterThanOrEqual(6);
    for (const capability of CAPABILITIES) {
      expect(capability.inputs.length).toBeGreaterThan(0);
      expect(capability.outputs.length).toBeGreaterThan(0);
      expect(CATEGORY_LABELS[capability.category]).toBeTruthy();
    }
  });

  it('loads the combined index.json with the same entries', () => {
    const combined = JSON.parse(readFileSync(resolve('src/data/index.json'), 'utf8'));
    const fromIndex = Registry.fromData(combined);
    expect(fromIndex.errors).toEqual([]);
    expect(fromIndex.entries).toHaveLength(9);
  });

  it('rejects malformed entries loudly', () => {
    const bad = Registry.fromData([{ id: 'x' }]);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('generates model docs from the registry', () => {
    const docs = generateModelDocs(registry);
    expect(docs).toContain('# Supported models');
    expect(docs).toContain('Whisper Large v3');
    expect(docs).toContain('unverified');
  });

  it('checked-in docs/models.md has not drifted from the registry', () => {
    const checkedIn = readFileSync(resolve('../../docs/models.md'), 'utf8');
    expect(checkedIn).toBe(generateModelDocs(registry));
  });
});

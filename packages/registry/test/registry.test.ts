import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORY_LABELS, CAPABILITIES, Registry } from '@openvideomaker/registry';
import { MODEL_ENTRIES } from '@openvideomaker/registry';
import { generateModelDocs, loadRegistryFromDir } from '@openvideomaker/registry/node';
import { resolve } from 'node:path';

describe('registry data', () => {
  const registry = Registry.fromData(MODEL_ENTRIES);

  it('loads every bundled entry without errors', () => {
    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(9);
  });

  it('has unique ids and valid capability references', () => {
    const ids = registry.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every trust state honestly as unverified for now', () => {
    for (const entry of registry.entries) {
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

  it('loads the same entries from disk', () => {
    const fromDisk = loadRegistryFromDir(resolve('src/data'));
    expect(fromDisk.errors).toEqual([]);
    expect(fromDisk.entries).toHaveLength(9);
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

import { describe, expect, it } from 'vitest';
import { generatedAsset, OperationError } from '@openvideomaker/core';
import { AUDIO_MEDIA, importedAsset, setupSession } from './helpers';

function makeCharacter(id: string, name = 'Alice') {
  return {
    id,
    name,
    avatar: { referenceImageAssetIds: [] as string[] },
    voice: { provider: 'system.tts', consent: { hasConsent: true } },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('character ops', () => {
  it('creates, updates, changes voice and removes characters', () => {
    const { session } = setupSession();
    let characterId = '';
    session.transaction((tx) => {
      characterId = tx.createCharacter({ character: makeCharacter(tx.newCharacterId()) });
    });
    expect(session.project.characters[characterId]?.name).toBe('Alice');

    session.transaction((tx) =>
      tx.updateCharacter({
        characterId,
        patch: { name: 'Alice B', description: 'a host', defaults: { realism: 0.9 } },
      }),
    );
    const character = session.project.characters[characterId];
    expect(character?.name).toBe('Alice B');
    expect(character?.description).toBe('a host');
    expect(character?.defaults?.realism).toBe(0.9);
    expect(character?.defaults?.gesture).toBe(0.3);

    session.transaction((tx) =>
      tx.changeVoice({ characterId, voice: { provider: 'hf/tts/example', consent: { hasConsent: false } } }),
    );
    expect(session.project.characters[characterId]?.voice.provider).toBe('hf/tts/example');
    expect(session.project.characters[characterId]?.voice.consent.hasConsent).toBe(false);

    session.transaction((tx) => tx.removeCharacter({ characterId }));
    expect(session.project.characters[characterId]).toBeUndefined();
  });

  it('rejects updates to missing characters', () => {
    const { session } = setupSession();
    expect(() =>
      session.transaction((tx) => tx.updateCharacter({ characterId: tx.newCharacterId(), patch: { name: 'Nope' } })),
    ).toThrow(OperationError);
  });
});

describe('generation ops', () => {
  it('records generated assets with provenance and regenerates them', () => {
    const { session } = setupSession();
    const generated = generatedAsset({
      kind: 'video',
      name: 'avatar.mp4',
      source: { kind: 'cas', ref: 'abc123' },
      media: { durationUs: 3_000_000, hasVideo: true, hasAudio: true },
      capability: 'avatar.image_to_video',
      model: { id: 'hf/example/avatar', revision: 'main' },
      runner: { kind: 'mock' },
      inputs: [{ kind: 'text', role: 'speech', text: 'hi there' }],
      regenerable: true,
    });
    session.transaction((tx) => tx.createGeneration({ asset: generated }));
    const asset = session.project.assets[generated.id];
    expect(asset?.origin.kind).toBe('generated');
    expect(asset?.origin.kind === 'generated' && asset.origin.provenance.capability).toBe('avatar.image_to_video');

    session.transaction((tx) =>
      tx.regenerateGeneration({ assetId: generated.id, newAssetId: tx.newAssetId(), source: { kind: 'cas', ref: 'def456' } }),
    );
    const regenerated = Object.values(session.project.assets).find((a) => a.name === 'avatar.mp4' && a.id !== generated.id);
    expect(regenerated?.origin.kind).toBe('generated');
    if (regenerated?.origin.kind === 'generated') {
      expect(regenerated.origin.provenance.regeneratedFrom).toBe(generated.id);
      expect(regenerated.origin.provenance.capability).toBe('avatar.image_to_video');
    }
  });

  it('rejects generation.create for non-generated assets', () => {
    const { session } = setupSession();
    const plain = importedAsset({ kind: 'audio', name: 's.wav', path: 'C:/s.wav', media: AUDIO_MEDIA });
    expect(() => session.transaction((tx) => tx.createGeneration({ asset: plain }))).toThrow(/generated origin/);
  });
});
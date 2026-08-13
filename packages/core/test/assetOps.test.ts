import { describe, expect, it } from 'vitest';
import { OperationError } from '@openvideomaker/core';
import { AUDIO_MEDIA, importedAsset, makeVideoClip, setupSession, setupSessionWithAsset } from './helpers';

describe('asset ops', () => {
  it('imports, updates and removes assets', () => {
    const { session } = setupSession();
    const asset = importedAsset({ kind: 'video', name: 'a.mp4', path: 'C:/a.mp4' });
    session.transaction((tx) => tx.importAsset({ asset }));
    expect(session.project.assets[asset.id]?.name).toBe('a.mp4');
    session.transaction((tx) =>
      tx.updateAsset({ assetId: asset.id, name: 'renamed.mp4', media: { durationUs: 5_000_000, hasVideo: true, hasAudio: false } }),
    );
    expect(session.project.assets[asset.id]?.name).toBe('renamed.mp4');
    expect(session.project.assets[asset.id]?.media?.durationUs).toBe(5_000_000);
    session.transaction((tx) => tx.removeAsset({ assetId: asset.id }));
    expect(session.project.assets[asset.id]).toBeUndefined();
  });

  it('refuses to remove an asset referenced by clips', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    expect(() => session.transaction((tx) => tx.removeAsset({ assetId: asset.id }))).toThrow(/still referenced/);
  });

  it('refuses to remove an asset used by a character', () => {
    const { session, sequenceId, trackId } = setupSessionWithAsset();
    const photo = importedAsset({ kind: 'image', name: 'face.png', path: 'C:/face.png' });
    session.transaction((tx) => {
      tx.importAsset({ asset: photo });
      tx.createCharacter({
        character: {
          id: tx.newCharacterId(),
          name: 'Alice',
          avatar: { referenceImageAssetIds: [photo.id] },
          voice: { provider: 'system.tts', consent: { hasConsent: true } },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
    });
    expect(() => session.transaction((tx) => tx.removeAsset({ assetId: photo.id }))).toThrow(/still referenced/);
  });

  it('replaces asset content keeping the same id', () => {
    const { session, asset } = setupSessionWithAsset();
    const replacement = importedAsset({ id: asset.id, kind: 'video', name: 'b.mp4', path: 'C:/b.mp4', media: { durationUs: 3_000_000, hasVideo: true, hasAudio: true } });
    session.transaction((tx) => tx.replaceAsset({ assetId: asset.id, asset: replacement }));
    expect(session.project.assets[asset.id]?.name).toBe('b.mp4');
  });
});
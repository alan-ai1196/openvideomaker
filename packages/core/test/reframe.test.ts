import { describe, expect, it } from 'vitest';
import { reframeToVertical } from '@openvideomaker/core';
import { setupSessionWithAsset, VIDEO_MEDIA, importedAsset, makeVideoClip } from './helpers';

describe('reframeToVertical', () => {
  it('sets vertical settings and center-crops 16:9 clips', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 4_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    const result = reframeToVertical(session, { sequenceId });
    expect(result?.reframedClips).toBe(1);
    expect(session.project.settings.width).toBe(1080);
    expect(session.project.settings.height).toBe(1920);
    const reframed = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === trackId)?.clips[0];
    if (!reframed || reframed.kind !== 'media') throw new Error('clip missing');
    const crop = reframed.crop;
    expect(crop).not.toBeNull();
    // 16:9 -> 9:16 keeps 81/256 of the width, cropped equally on both sides.
    expect(crop!.left).toBeCloseTo(0.3418, 2);
    expect(crop!.right).toBeCloseTo(0.3418, 2);
    expect(crop!.top).toBe(0);
    expect(crop!.bottom).toBe(0);
  });

  it('leaves already-vertical sources untouched', () => {
    const { session, sequenceId, trackId } = setupSessionWithAsset();
    const vertical = importedAsset({ kind: 'video', name: 'v.mp4', path: 'C:/v.mp4', media: { ...VIDEO_MEDIA, width: 1080, height: 1920 } });
    session.transaction((tx) => {
      tx.importAsset({ asset: vertical });
      tx.insertClip({ sequenceId, trackId, clip: makeVideoClip(trackId, vertical.id, 0, 2_000_000) });
    });
    const result = reframeToVertical(session, { sequenceId });
    expect(result?.reframedClips).toBe(0);
    const clip = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === trackId)?.clips[0];
    expect(clip?.kind === 'media' ? clip.crop : 'not-media').toBeNull();
  });

  it('is one undoable transaction', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const clip = makeVideoClip(trackId, asset.id, 0, 4_000_000);
    session.transaction((tx) => tx.insertClip({ sequenceId, trackId, clip }));
    const anchor = session.checkpoint;
    reframeToVertical(session, { sequenceId });
    while (session.checkpoint > anchor) session.undo();
    expect(session.project.settings.width).toBe(1920);
    const restored = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === trackId)?.clips[0];
    expect(restored?.kind === 'media' ? restored.crop : 'x').toBeNull();
    while (session.canRedo) session.redo();
    expect(session.project.settings.height).toBe(1920);
  });
});

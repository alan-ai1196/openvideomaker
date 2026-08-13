import { describe, expect, it } from 'vitest';
import { OperationError } from '@openvideomaker/core';
import { makeVideoClip, setupSession, setupSessionWithAsset } from './helpers';

describe('track ops', () => {
  it('creates, renames, mutes, locks and disables tracks', () => {
    const { session, sequenceId } = setupSession();
    let trackId = '';
    session.transaction((tx) => {
      trackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video', name: 'Main' });
    });
    expect(session.project.sequences[sequenceId]?.tracks.find((t) => t.id === trackId)?.name).toBe('Main');
    session.transaction((tx) => {
      tx.renameTrack({ sequenceId, trackId, name: 'Main 2' });
      tx.muteTrack({ sequenceId, trackId, muted: true });
      tx.lockTrack({ sequenceId, trackId, locked: true });
      tx.enableTrack({ sequenceId, trackId, enabled: false });
    });
    const track = session.project.sequences[sequenceId]?.tracks.find((t) => t.id === trackId);
    expect(track?.name).toBe('Main 2');
    expect(track?.muted).toBe(true);
    expect(track?.locked).toBe(true);
    expect(track?.enabled).toBe(false);
  });

  it('removes a track with its clips and unlinks other clips', () => {
    const { session, sequenceId, trackId, audioTrackId, asset } = setupSessionWithAsset();
    const video = makeVideoClip(trackId, asset.id, 0, 1_000_000);
    const audio = makeVideoClip(audioTrackId, asset.id, 0, 1_000_000);
    audio.linkedClipId = video.id;
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: video });
      tx.insertClip({ sequenceId, trackId: audioTrackId, clip: audio });
    });
    session.transaction((tx) => tx.removeTrack({ sequenceId, trackId: audioTrackId }));
    expect(session.project.sequences[sequenceId]?.tracks.find((t) => t.id === audioTrackId)).toBeUndefined();
    const videoClip = session.project.sequences[sequenceId]?.tracks[0]?.clips[0];
    expect(videoClip?.linkedClipId).toBeNull();
  });

  it('rejects removing a missing track', () => {
    const { session, sequenceId } = setupSession();
    expect(() => session.transaction((tx) => tx.removeTrack({ sequenceId, trackId: tx.newTrackId() }))).toThrow(OperationError);
  });
});

describe('sequence ops', () => {
  it('creates sequences with default names and activates them', () => {
    const { session } = setupSession();
    let second = '';
    session.transaction((tx) => {
      second = tx.createSequence({ sequenceId: tx.newSequenceId() });
    });
    expect(session.project.sequences[second]?.name).toBe('Sequence 3');
    session.transaction((tx) => tx.activateSequence({ sequenceId: second }));
    expect(session.project.activeSequenceId).toBe(second);
    session.transaction((tx) => tx.activateSequence({ sequenceId: null }));
    expect(session.project.activeSequenceId).toBeNull();
  });

  it('refuses to remove the last sequence', () => {
    const { session, sequenceId } = setupSession();
    const defaultSequenceId = Object.keys(session.project.sequences).find((id) => id !== sequenceId)!;
    session.transaction((tx) => tx.removeSequence({ sequenceId: defaultSequenceId }));
    expect(() => session.transaction((tx) => tx.removeSequence({ sequenceId }))).toThrow(/only sequence/);
  });

  it('removes a non-active sequence and clears activeSequenceId when needed', () => {
    const { session, sequenceId } = setupSession();
    const defaultSequenceId = Object.keys(session.project.sequences).find((id) => id !== sequenceId)!;
    let second = '';
    session.transaction((tx) => {
      second = tx.createSequence({ sequenceId: tx.newSequenceId() });
    });
    session.transaction((tx) => tx.removeSequence({ sequenceId: second }));
    expect(session.project.sequences[second]).toBeUndefined();
    expect(session.project.activeSequenceId).toBe(defaultSequenceId);
    session.transaction((tx) => tx.removeSequence({ sequenceId: defaultSequenceId }));
    expect(session.project.activeSequenceId).toBeNull();
  });
});
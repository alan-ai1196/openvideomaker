import { newAssetId, newTrackId, type MediaInfo, type ProjectSettings } from '@openvideomaker/schema';
import { importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';

export const VIDEO_MEDIA: MediaInfo = {
  durationUs: 60_000_000,
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
};

export const AUDIO_MEDIA: MediaInfo = {
  durationUs: 60_000_000,
  hasVideo: false,
  hasAudio: true,
};

export const IMAGE_MEDIA: MediaInfo = {
  durationUs: 60_000_000,
  hasVideo: true,
  hasAudio: false,
  width: 1920,
  height: 1080,
};

export interface SetupSessionOptions {
  name?: string;
  settings?: Partial<ProjectSettings>;
}

/** A session with one sequence and one video track, ready for clip work. */
export function setupSession(options: SetupSessionOptions = {}) {
  const session = ProjectSession.create(options.name ?? 'Test Project', { settings: options.settings });
  let sequenceId = '';
  let trackId = '';
  session.transaction((tx) => {
    sequenceId = tx.createSequence({ sequenceId: tx.newSequenceId() });
    trackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video' });
  });
  return { session, sequenceId, trackId };
}

/** A session with a video + audio track, plus one imported video asset. */
export function setupSessionWithAsset(options: SetupSessionOptions = {}) {
  const { session, sequenceId, trackId } = setupSession(options);
  const asset = importedAsset({ kind: 'video', name: 'a.mp4', path: 'C:/a.mp4', media: VIDEO_MEDIA });
  let audioTrackId = '';
  session.transaction((tx) => {
    tx.importAsset({ asset });
    audioTrackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'audio' });
  });
  return { session, sequenceId, trackId, audioTrackId, asset };
}

export function makeVideoClip(trackId: string, assetId: string, start: number, duration: number) {
  return mediaClip({ trackId, assetId, start, duration });
}

export { importedAsset, mediaClip, ProjectSession, newAssetId, newTrackId };
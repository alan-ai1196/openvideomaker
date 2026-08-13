import {
  importedAsset,
  mediaClip,
  textClip,
  captionClip,
  ProjectSession,
} from '@openvideomaker/core';
import { newSegmentId, newTranscriptId, type AssetId, type SequenceId, type TrackId } from '@openvideomaker/schema';

/**
 * Builds the first-launch welcome project through ordinary operations,
 * so every clip in it is fully editable - nothing about the demo is fake
 * or locked. Assets reference placeholder content (no real media yet).
 */
export function createWelcomeSession(): ProjectSession {
  const session = ProjectSession.create('Welcome Project', {
    settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, audioChannels: 2 },
  });
  const sequenceId = Object.keys(session.project.sequences)[0]! as SequenceId;

  const assets: Record<string, AssetId> = {};
  const tracks: Record<string, TrackId> = {};

  session.transaction((tx) => {
    const intro = importedAsset({
      kind: 'video',
      name: 'Intro shot',
      path: 'demo://intro',
      source: { kind: 'cas', ref: 'demo:intro' },
      media: { durationUs: 4_000_000, hasVideo: true, hasAudio: false, width: 1920, height: 1080, fps: { num: 30, den: 1 }, codec: 'h264', format: 'mp4' },
    });
    const talking = importedAsset({
      kind: 'video',
      name: 'Talking head',
      path: 'demo://talking',
      source: { kind: 'cas', ref: 'demo:talking' },
      media: { durationUs: 12_000_000, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: { num: 30, den: 1 }, codec: 'h264', format: 'mp4' },
    });
    const outro = importedAsset({
      kind: 'video',
      name: 'Outro',
      path: 'demo://outro',
      source: { kind: 'cas', ref: 'demo:outro' },
      media: { durationUs: 6_000_000, hasVideo: true, hasAudio: false, width: 1920, height: 1080, fps: { num: 30, den: 1 }, codec: 'h264', format: 'mp4' },
    });
    const music = importedAsset({
      kind: 'audio',
      name: 'Bed music',
      path: 'demo://music',
      source: { kind: 'cas', ref: 'demo:music' },
      media: { durationUs: 20_000_000, hasVideo: false, hasAudio: true, audioChannels: 2, sampleRate: 48000, codec: 'aac', format: 'm4a' },
    });
    tx.importAsset({ asset: intro });
    tx.importAsset({ asset: talking });
    tx.importAsset({ asset: outro });
    tx.importAsset({ asset: music });
    assets.intro = intro.id;
    assets.talking = talking.id;
    assets.outro = outro.id;
    assets.music = music.id;

    tracks.video = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video', name: 'Video 1' });
    tracks.audio = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'audio', name: 'Audio 1' });
    tracks.text = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'text', name: 'Text 1' });
  });

  session.transaction((tx) => {
    tx.insertClip({
      sequenceId,
      trackId: tracks.video!,
      clip: mediaClip({ trackId: tracks.video!, assetId: assets.intro!, start: 0, duration: 4_000_000 }),
    });
    tx.insertClip({
      sequenceId,
      trackId: tracks.video!,
      clip: mediaClip({ trackId: tracks.video!, assetId: assets.talking!, start: 4_000_000, duration: 6_000_000, inPoint: 0 }),
    });
    tx.insertClip({
      sequenceId,
      trackId: tracks.video!,
      clip: mediaClip({ trackId: tracks.video!, assetId: assets.outro!, start: 10_000_000, duration: 3_000_000 }),
    });
    tx.insertClip({
      sequenceId,
      trackId: tracks.audio!,
      clip: mediaClip({ trackId: tracks.audio!, assetId: assets.music!, start: 0, duration: 13_000_000 }),
    });
  });

  session.transaction((tx) => {
    tx.insertClip({
      sequenceId,
      trackId: tracks.text!,
      clip: textClip({ trackId: tracks.text!, start: 0, duration: 3_000_000, content: 'Make videos with AI.' }),
    });
    tx.insertClip({
      sequenceId,
      trackId: tracks.text!,
      clip: captionClip({
        trackId: tracks.text!,
        start: 4_000_000,
        duration: 6_000_000,
        segments: [
          { text: 'Everything stays editable', start: 0, end: 3_000_000 },
          { text: 'even after AI does its part', start: 3_000_000, end: 6_000_000 },
        ],
      }),
    });
  });

  // A demo transcript linked to the talking-head asset, so the
  // Transcript panel shows real editable content on first launch.
  session.transaction((tx) => {
    const now = new Date().toISOString();
    tx.createTranscript({
      transcript: {
        id: newTranscriptId(),
        assetId: assets.talking!,
        language: 'en',
        segments: [
          { id: newSegmentId(), startUs: 0, endUs: 2_000_000, text: 'OpenVideoMaker keeps everything editable.' },
          { id: newSegmentId(), startUs: 2_000_000, endUs: 4_500_000, text: 'AI helps you make videos, and every result stays yours to change.' },
          { id: newSegmentId(), startUs: 4_500_000, endUs: 6_000_000, text: 'Click a line to jump the playhead there.' },
        ],
        source: { kind: 'manual' },
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  return session;
}
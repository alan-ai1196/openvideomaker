import type { Asset, CaptionSegment, Clip, MediaClip, Project, Track } from '@openvideomaker/schema';
import type { Violation } from '../types.js';

/**
 * Deterministic structural checks over the whole project. Fast, cheap and
 * reproducible - these run after every transaction and are also exposed
 * for agent verification. Violations are collected, not fail-fast, so a
 * bad edit reports everything wrong at once.
 */
export function collectViolations(project: Project): Violation[] {
  const v: Violation[] = [];
  const push = (code: string, message: string, path: string): void => {
    v.push({ code, message, path });
  };

  const sequences = Object.entries(project.sequences);
  if (sequences.length === 0) push('project.no-sequences', 'project must contain at least one sequence', 'sequences');

  if (project.activeSequenceId !== null && !project.sequences[project.activeSequenceId]) {
    push('project.active-missing', 'activeSequenceId refers to a missing sequence', 'activeSequenceId');
  }

  for (const [key, asset] of Object.entries(project.assets)) {
    if (key !== asset.id) push('asset.key-mismatch', 'asset record key does not match asset id', 'assets.' + key);
    if (asset.proxy && !project.assets[asset.proxy.assetId]) {
      push('asset.proxy-missing', 'proxy asset not found: ' + asset.proxy.assetId, 'assets.' + key + '.proxy');
    }
  }

  for (const [key, character] of Object.entries(project.characters)) {
    if (key !== character.id) push('character.key-mismatch', 'character record key does not match character id', 'characters.' + key);
    for (const ref of character.avatar.referenceImageAssetIds) {
      if (!project.assets[ref]) push('character.asset-missing', 'avatar reference asset not found: ' + ref, 'characters.' + key);
    }
    if (character.avatar.referenceVideoAssetId && !project.assets[character.avatar.referenceVideoAssetId]) {
      push('character.asset-missing', 'avatar video asset not found', 'characters.' + key);
    }
    if (character.voice.sampleAudioAssetId && !project.assets[character.voice.sampleAudioAssetId]) {
      push('character.asset-missing', 'voice sample asset not found', 'characters.' + key);
    }
  }

  for (const [key, transcript] of Object.entries(project.transcripts)) {
    if (key !== transcript.id) push('transcript.key-mismatch', 'transcript record key does not match transcript id', 'transcripts.' + key);
    if (!project.assets[transcript.assetId]) {
      push('transcript.asset-missing', 'transcript references missing asset: ' + transcript.assetId, 'transcripts.' + key);
    }
    if (project.assetTranscripts[transcript.assetId] !== transcript.id) {
      push('transcript.link-missing', 'assetTranscripts does not link this transcript', 'transcripts.' + key);
    }
    let previousEnd = -1;
    for (let i = 0; i < transcript.segments.length; i++) {
      const seg = transcript.segments[i]!;
      const segPath = 'transcripts.' + key + '.segments[' + i + ']';
      if (seg.startUs < 0 || seg.endUs <= seg.startUs) {
        push('transcript.segment-range', 'transcript segment empty or out of range', segPath);
      }
      if (seg.startUs < previousEnd) {
        push('transcript.segment-overlap', 'transcript segments overlap or are unordered', segPath);
      }
      previousEnd = seg.endUs;
    }
  }
  for (const [assetId, transcriptId] of Object.entries(project.assetTranscripts)) {
    if (!project.transcripts[transcriptId]) {
      push('transcript.link-missing', 'assetTranscripts points to a missing transcript', 'assetTranscripts.' + assetId);
    }
  }

  for (const [key, script] of Object.entries(project.scripts)) {
    if (key !== script.id) push('script.key-mismatch', 'script record key does not match script id', 'scripts.' + key);
    const seenLineIds = new Set<string>();
    for (let i = 0; i < script.lines.length; i++) {
      const line = script.lines[i]!;
      const linePath = 'scripts.' + key + '.lines[' + i + ']';
      if (seenLineIds.has(line.id)) push('script.duplicate-line', 'duplicate line id: ' + line.id, linePath);
      seenLineIds.add(line.id);
      if (line.characterId && !project.characters[line.characterId]) {
        push('script.character-missing', 'line references missing character: ' + line.characterId, linePath);
      }
      if (line.startUs !== undefined && line.durationUs !== undefined && line.durationUs <= 0) {
        push('script.line-duration', 'line duration must be positive', linePath);
      }
    }
  }

  // Pass 1: gather every clip id project-wide (links may point anywhere).
  const seenClipIds = new Set<string>();
  const clipPaths = new Map<string, string>();
  for (const [seqKey, sequence] of sequences) {
    for (const track of sequence.tracks) {
      track.clips.forEach((clip, i) => {
        seenClipIds.add(clip.id);
        clipPaths.set(clip.id, 'sequences.' + seqKey + '.tracks.' + track.id + '.clips[' + i + ']');
      });
    }
  }

  // Pass 2: per-sequence/track/clip checks.
  for (const [seqKey, sequence] of sequences) {
    if (seqKey !== sequence.id) push('sequence.key-mismatch', 'sequence record key does not match sequence id', 'sequences.' + seqKey);
    const seenTrackIds = new Set<string>();
    for (const track of sequence.tracks) {
      if (seenTrackIds.has(track.id)) {
        push('track.duplicate-id', 'duplicate track id: ' + track.id, 'sequences.' + seqKey + '.tracks');
      }
      seenTrackIds.add(track.id);
      checkTrack(project, seqKey, track, clipPaths, push);
    }
    const seenMarkerIds = new Set<string>();
    for (const marker of sequence.markers) {
      if (seenMarkerIds.has(marker.id)) {
        push('marker.duplicate-id', 'duplicate marker id: ' + marker.id, 'sequences.' + seqKey + '.markers');
      }
      seenMarkerIds.add(marker.id);
    }
  }
  return v;
}

function checkTrack(
  project: Project,
  seqKey: string,
  track: Track,
  clipPaths: Map<string, string>,
  push: (code: string, message: string, path: string) => void,
): void {
  const trackPath = 'sequences.' + seqKey + '.tracks.' + track.id;
  let previousEnd = -1;
  let previousClip: Clip | null = null;
  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i]!;
    const clipPath = trackPath + '.clips[' + i + ']';
    if (clip.trackId !== track.id) {
      push('clip.track-mismatch', 'clip.trackId does not match its track', clipPath + '.trackId');
    }
    if (clip.duration <= 0) push('clip.duration', 'clip duration must be positive', clipPath + '.duration');
    if (clip.start < 0) push('clip.start', 'clip start must be non-negative', clipPath + '.start');
    if (previousClip && previousEnd > clip.start) {
      push(
        'clip.overlap',
        'clip overlaps previous clip (' + previousClip.id + ') on track ' + track.id,
        clipPath + '.start',
      );
    }
    previousEnd = clip.start + clip.duration;
    previousClip = clip;

    const fxIds = new Set<string>();
    for (let fi = 0; fi < clip.effects.length; fi++) {
      const fx = clip.effects[fi]!;
      if (fxIds.has(fx.id)) push('effect.duplicate-id', 'duplicate effect id: ' + fx.id, clipPath + '.effects[' + fi + ']');
      fxIds.add(fx.id);
      for (const kf of fx.keyframes) {
        if (kf.at < 0 || kf.at > clip.duration) {
          push('keyframe.range', 'effect keyframe outside clip bounds', clipPath + '.effects[' + fi + ']');
        }
      }
    }
    if (clip.transitionIn && clip.transitionIn.durationUs > clip.duration) {
      push('transition.range', 'transition in exceeds clip duration', clipPath + '.transitionIn');
    }
    if (clip.transitionOut && clip.transitionOut.durationUs > clip.duration) {
      push('transition.range', 'transition out exceeds clip duration', clipPath + '.transitionOut');
    }
    if (clip.linkedClipId !== null) {
      if (clip.linkedClipId === clip.id) {
        push('clip.link-self', 'clip links to itself', clipPath + '.linkedClipId');
      } else if (!clipPaths.has(clip.linkedClipId)) {
        push('clip.link-missing', 'linked clip not found: ' + clip.linkedClipId, clipPath + '.linkedClipId');
      }
    }
    checkClipContent(project, track, clip, clipPath, push);
  }
}

function checkClipContent(
  project: Project,
  track: Track,
  clip: Clip,
  clipPath: string,
  push: (code: string, message: string, path: string) => void,
): void {
  if (clip.kind === 'media') {
    const asset = project.assets[clip.assetId];
    if (!asset) {
      push('clip.asset-missing', 'clip references missing asset: ' + clip.assetId, clipPath + '.assetId');
      return;
    }
    const media = asset.media;
    if (clip.crop && (clip.crop.left + clip.crop.right >= 1 || clip.crop.top + clip.crop.bottom >= 1)) {
      push('clip.crop-exhausted', 'crop removes the entire source frame', clipPath + '.crop');
    }
    if (media) {
      // Still images have no intrinsic duration: the clip decides how
      // long the still is held, so the source can never be exceeded.
      if (asset.kind !== 'image') {
        const used = clip.inPoint + clip.duration * clip.speed;
        if (used > media.durationUs) {
          push('clip.source-exceeds', 'clip consumes more source than the asset provides', clipPath + '.inPoint');
        }
      }
      if (track.kind === 'audio' && !media.hasAudio) {
        push('track.kind-mismatch', 'video-only asset on an audio track', clipPath);
      }
      if (track.kind !== 'audio' && media.hasAudio && !media.hasVideo) {
        push('track.kind-mismatch', 'audio-only asset on a ' + track.kind + ' track', clipPath);
      }
    }
  } else if (track.kind === 'audio') {
    push('track.kind-mismatch', clip.kind + ' clip on an audio track', clipPath);
  }
  if (clip.kind === 'caption') {
    checkCaptionSegments(clip.segments, clip.duration, clipPath, push);
  }
}

function checkCaptionSegments(
  segments: CaptionSegment[],
  duration: number,
  clipPath: string,
  push: (code: string, message: string, path: string) => void,
): void {
  let previousEnd = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segPath = clipPath + '.segments[' + i + ']';
    if (seg.start < 0 || seg.end > duration || seg.end <= seg.start) {
      push('caption.segment-range', 'caption segment outside clip bounds or empty', segPath);
    }
    if (seg.start < previousEnd) {
      push('caption.segment-overlap', 'caption segments overlap or are unordered', segPath);
    }
    previousEnd = seg.end;
  }
}

/** True when a media clip's source usage is within its asset (when known). */
export function sourceUsageFits(clip: MediaClip, asset: Asset | undefined): boolean {
  const media = asset?.media;
  if (!media) return true;
  return clip.inPoint + clip.duration * clip.speed <= media.durationUs;
}
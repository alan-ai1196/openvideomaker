import type {
  Asset,
  CaptionSegment,
  Clip,
  ClipAudio,
  Keyframe,
  MediaClip,
  Project,
  Track,
  TrackKind,
} from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import { allClips, findClip, findTrack, sortTrackClips } from '../find.js';
import type { ApplyFn } from '../types.js';
import type {
  ClipAssetParams,
  ClipAudioParams,
  ClipCropParams,
  ClipEnableParams,
  ClipInsertParams,
  ClipMoveParams,
  ClipOpacityParams,
  ClipRemoveParams,
  ClipSpeedParams,
  ClipSplitParams,
  ClipTransformParams,
  ClipTrimParams,
} from '@openvideomaker/schema';

/**
 * Soft track-kind rules, enforced at operation time with clear errors:
 * - audio tracks accept media clips whose asset carries audio (or unknown);
 * - non-audio tracks reject pure-audio media clips;
 * - non-media clips (text/caption/color) live on non-audio tracks.
 */
export function checkClipTrackCompatibility(clip: Clip, track: Track): void {
  if (track.kind === 'audio') {
    if (clip.kind !== 'media') {
      throw new OperationError('op.validation', clip.kind + ' clips cannot live on an audio track');
    }
  } else if (clip.kind === 'media') {
    // resolved below, needs asset info
  } else {
    return;
  }
}

export function checkMediaClipFitsTrack(clip: MediaClip, asset: Asset | undefined, trackKind: TrackKind): void {
  const media = asset?.media;
  if (!media) return;
  if (trackKind === 'audio' && !media.hasAudio) {
    throw new OperationError('op.validation', 'asset has no audio track: ' + asset!.id);
  }
  if (trackKind !== 'audio' && media.hasAudio && !media.hasVideo) {
    throw new OperationError('op.validation', 'audio-only asset cannot live on a ' + trackKind + ' track');
  }
}

/** Source consumption for a media clip = timeline duration x speed. */
export function checkSourceFits(clip: MediaClip, asset: Asset | undefined): void {
  const media = asset?.media;
  if (!media) return;
  const used = clip.inPoint + clip.duration * clip.speed;
  if (used > media.durationUs) {
    throw new OperationError(
      'op.validation',
      'clip exceeds source duration: needs ' +
        Math.ceil(used) +
        'us, source has ' +
        media.durationUs +
        'us (' +
        asset!.id +
        ')',
    );
  }
}

function requireMediaAsset(project: Project, assetId: string): Asset {
  const asset = project.assets[assetId];
  if (!asset) throw new OperationError('op.not-found', 'asset not found: ' + assetId);
  return asset;
}

export const applyClipInsert: ApplyFn<ClipInsertParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  if (params.clip.trackId !== params.trackId) {
    throw new OperationError('op.validation', 'clip.trackId must match the target track');
  }
  if (allClips(project).some(({ clip }) => clip.id === params.clip.id)) {
    throw new OperationError('op.validation', 'clip id already used: ' + params.clip.id);
  }
  const at = params.at ?? loc.track.clips.length;
  if (at < 0 || at > loc.track.clips.length) {
    throw new OperationError('op.validation', 'clip index out of range: ' + at);
  }
  if (params.clip.kind === 'media') {
    const asset = requireMediaAsset(project, params.clip.assetId);
    checkMediaClipFitsTrack(params.clip, asset, loc.track.kind);
    checkSourceFits(params.clip, asset);
  } else {
    checkClipTrackCompatibility(params.clip, loc.track);
  }
  loc.track.clips.splice(at, 0, params.clip);
  project.updatedAt = ctx.now;
};

export const applyClipRemove: ApplyFn<ClipRemoveParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.track.clips.splice(loc.clipIndex, 1);
  for (const { clip } of allClips(project)) {
    if (clip.linkedClipId === params.clipId) clip.linkedClipId = null;
  }
  project.updatedAt = ctx.now;
};

export const applyClipMove: ApplyFn<ClipMoveParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  let target = loc.track;
  if (params.trackId !== undefined && params.trackId !== loc.track.id) {
    const targetLoc = findTrack(project, params.sequenceId, params.trackId);
    if (!targetLoc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
    target = targetLoc.track;
    if (loc.clip.kind === 'media') {
      const asset = project.assets[loc.clip.assetId];
      checkMediaClipFitsTrack(loc.clip, asset, target.kind);
    } else {
      checkClipTrackCompatibility(loc.clip, target);
    }
    loc.track.clips.splice(loc.clipIndex, 1);
    loc.clip.trackId = target.id;
    target.clips.push(loc.clip);
    sortTrackClips(target);
  }
  if (params.start !== undefined) {
    loc.clip.start = params.start;
    sortTrackClips(target);
  }
  project.updatedAt = ctx.now;
};

export const applyClipTrim: ApplyFn<ClipTrimParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  const clip = loc.clip;
  if (params.start !== undefined) clip.start = params.start;
  if (params.duration !== undefined) clip.duration = params.duration;
  if (params.inPoint !== undefined && clip.kind === 'media') {
    clip.inPoint = params.inPoint;
  } else if (params.inPoint !== undefined) {
    throw new OperationError('op.validation', 'inPoint trim only applies to media clips');
  }
  if (clip.kind === 'media') {
    checkSourceFits(clip, project.assets[clip.assetId]);
  }
  if (clip.kind === 'caption') {
    clip.segments = clip.segments
      .map((seg) => ({
        ...seg,
        start: Math.min(seg.start, clip.duration),
        end: Math.min(seg.end, clip.duration),
      }))
      .filter((seg) => seg.end > seg.start && seg.start < clip.duration);
  }
  loc.track.clips.splice(loc.clipIndex, 1, clip);
  project.updatedAt = ctx.now;
};

function splitKeyframes(keyframes: Keyframe[], at: number): { left: Keyframe[]; right: Keyframe[] } {
  const left: Keyframe[] = [];
  const right: Keyframe[] = [];
  for (const kf of keyframes) {
    if (kf.at <= at) left.push(kf);
    else right.push({ ...kf, at: kf.at - at });
  }
  return { left, right };
}

function splitCaptionSegments(segments: CaptionSegment[], at: number): { left: CaptionSegment[]; right: CaptionSegment[] } {
  const left: CaptionSegment[] = [];
  const right: CaptionSegment[] = [];
  for (const seg of segments) {
    if (seg.end <= at) {
      left.push(seg);
    } else if (seg.start >= at) {
      right.push({ ...seg, start: seg.start - at, end: seg.end - at });
    } else {
      left.push({ ...seg, end: at });
      right.push({ ...seg, start: 0, end: seg.end - at });
    }
  }
  return { left, right };
}

export const applyClipSplit: ApplyFn<ClipSplitParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (params.at <= 0 || params.at >= loc.clip.duration) {
    throw new OperationError('op.validation', 'split point must be strictly inside the clip');
  }
  if (params.leftClipId === params.rightClipId) {
    throw new OperationError('op.validation', 'split clip ids must differ');
  }
  if (allClips(project).some(({ clip }) => clip.id === params.leftClipId || clip.id === params.rightClipId)) {
    throw new OperationError('op.validation', 'split clip id already used');
  }
  const base = { ...loc.clip } as Clip;
  const leftEffects = base.effects.map((fx) => ({ ...fx, keyframes: splitKeyframes(fx.keyframes, params.at).left }));
  const rightEffects = base.effects.map((fx) => ({ ...fx, keyframes: splitKeyframes(fx.keyframes, params.at).right }));
  const common = {
    id: '',
    start: base.start,
    duration: base.duration,
    speed: base.speed,
    enabled: base.enabled,
    opacity: base.opacity,
    transform: base.transform,
    crop: base.crop,
    audio: base.audio,
    trackId: base.trackId,
    linkedClipId: base.linkedClipId,
    provenance: base.provenance,
  };
  let left: Clip;
  let right: Clip;
  if (base.kind === 'media') {
    left = { ...common, ...base, id: params.leftClipId, duration: params.at, transitionOut: null, effects: leftEffects, inPoint: base.inPoint };
    right = {
      ...common,
      ...base,
      id: params.rightClipId,
      start: base.start + params.at,
      duration: base.duration - params.at,
      transitionIn: null,
      effects: rightEffects,
      inPoint: base.inPoint + Math.round(params.at * base.speed),
    };
  } else if (base.kind === 'caption') {
    const parts = splitCaptionSegments(base.segments, params.at);
    left = { ...common, ...base, id: params.leftClipId, duration: params.at, transitionOut: null, effects: leftEffects, segments: parts.left };
    right = {
      ...common,
      ...base,
      id: params.rightClipId,
      start: base.start + params.at,
      duration: base.duration - params.at,
      transitionIn: null,
      effects: rightEffects,
      segments: parts.right,
    };
  } else {
    left = { ...common, ...base, id: params.leftClipId, duration: params.at, transitionOut: null, effects: leftEffects };
    right = {
      ...common,
      ...base,
      id: params.rightClipId,
      start: base.start + params.at,
      duration: base.duration - params.at,
      transitionIn: null,
      effects: rightEffects,
    };
  }
  loc.track.clips.splice(loc.clipIndex, 1, left, right);
  project.updatedAt = ctx.now;
};

export const applyClipTransform: ApplyFn<ClipTransformParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.clip.transform = { ...loc.clip.transform, ...params.transform };
  project.updatedAt = ctx.now;
};

export const applyClipOpacity: ApplyFn<ClipOpacityParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.clip.opacity = params.opacity;
  project.updatedAt = ctx.now;
};

export const applyClipCrop: ApplyFn<ClipCropParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.clip.crop = params.crop;
  project.updatedAt = ctx.now;
};

export const applyClipSpeed: ApplyFn<ClipSpeedParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.clip.speed = params.speed;
  if (loc.clip.kind === 'media') checkSourceFits(loc.clip, project.assets[loc.clip.assetId]);
  project.updatedAt = ctx.now;
};

export const applyClipEnable: ApplyFn<ClipEnableParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  loc.clip.enabled = params.enabled;
  project.updatedAt = ctx.now;
};

export const applyClipAudio: ApplyFn<ClipAudioParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (params.audio === null) {
    loc.clip.audio = null;
  } else {
    loc.clip.audio = ({ ...(loc.clip.audio ?? {}), ...params.audio }) as ClipAudio;
    if (loc.clip.kind === 'media' && loc.clip.audio) {
      if (loc.clip.audio.fadeInUs + loc.clip.audio.fadeOutUs > loc.clip.duration) {
        throw new OperationError('op.validation', 'audio fades exceed clip duration');
      }
    }
  }
  project.updatedAt = ctx.now;
};

export const applyClipAsset: ApplyFn<ClipAssetParams> = (project, params, ctx) => {
  const loc = findClip(project, params.sequenceId, params.clipId);
  if (!loc) throw new OperationError('op.not-found', 'clip not found: ' + params.clipId);
  if (loc.clip.kind !== 'media') {
    throw new OperationError('op.validation', 'clip.asset only applies to media clips');
  }
  const asset = requireMediaAsset(project, params.assetId);
  loc.clip.assetId = params.assetId;
  loc.clip.inPoint = params.inPoint ?? 0;
  checkMediaClipFitsTrack(loc.clip, asset, loc.track.kind);
  checkSourceFits(loc.clip, asset);
  project.updatedAt = ctx.now;
};
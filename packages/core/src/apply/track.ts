import type { Project } from '@openvideomaker/schema';
import { OperationError } from '../errors.js';
import { findTrack } from '../find.js';
import type { ApplyFn } from '../types.js';
import type {
  TrackCreateParams,
  TrackEnableParams,
  TrackKind,
  TrackLockParams,
  TrackMuteParams,
  TrackRemoveParams,
  TrackRenameParams,
} from '@openvideomaker/schema';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nextTrackName(sequence: { tracks: { kind: TrackKind }[] }, kind: TrackKind): string {
  const sameKind = sequence.tracks.filter((t) => t.kind === kind).length;
  return capitalize(kind) + ' ' + (sameKind + 1);
}

export const applyTrackCreate: ApplyFn<TrackCreateParams> = (project, params, ctx) => {
  const sequence = project.sequences[params.sequenceId];
  if (!sequence) throw new OperationError('op.not-found', 'sequence not found: ' + params.sequenceId);
  if (sequence.tracks.some((t) => t.id === params.trackId)) {
    throw new OperationError('op.validation', 'track already exists: ' + params.trackId);
  }
  const at = params.at ?? sequence.tracks.length;
  if (at < 0 || at > sequence.tracks.length) {
    throw new OperationError('op.validation', 'track index out of range: ' + at);
  }
  sequence.tracks.splice(at, 0, {
    id: params.trackId,
    kind: params.kind,
    name: params.name ?? nextTrackName(sequence, params.kind),
    enabled: true,
    muted: false,
    locked: false,
    clips: [],
  });
  project.updatedAt = ctx.now;
};

export const applyTrackRemove: ApplyFn<TrackRemoveParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  const removedClipIds = new Set(loc.track.clips.map((c) => c.id));
  loc.sequence.tracks.splice(loc.index, 1);
  // Unlink any surviving clips that pointed at clips removed with the track.
  for (const sequence of Object.values(project.sequences)) {
    for (const track of sequence.tracks) {
      for (const clip of track.clips) {
        if (clip.linkedClipId && removedClipIds.has(clip.linkedClipId)) clip.linkedClipId = null;
      }
    }
  }
  project.updatedAt = ctx.now;
};

export const applyTrackRename: ApplyFn<TrackRenameParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  loc.track.name = params.name;
  project.updatedAt = ctx.now;
};

export const applyTrackEnable: ApplyFn<TrackEnableParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  loc.track.enabled = params.enabled;
  project.updatedAt = ctx.now;
};

export const applyTrackLock: ApplyFn<TrackLockParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  loc.track.locked = params.locked;
  project.updatedAt = ctx.now;
};

export const applyTrackMute: ApplyFn<TrackMuteParams> = (project, params, ctx) => {
  const loc = findTrack(project, params.sequenceId, params.trackId);
  if (!loc) throw new OperationError('op.not-found', 'track not found: ' + params.trackId);
  loc.track.muted = params.muted;
  project.updatedAt = ctx.now;
};
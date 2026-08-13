import type {
  ClipId,
  Project,
  Sequence,
  SequenceId,
  Track,
  TrackId,
} from '@openvideomaker/schema';

export interface TrackLocation {
  sequence: Sequence;
  track: Track;
  index: number;
}

export interface ClipLocation {
  sequence: Sequence;
  track: Track;
  clip: Extract<Track['clips'][number], { id: ClipId }>;
  trackIndex: number;
  clipIndex: number;
}

export function findSequence(project: Project, sequenceId: SequenceId): Sequence | undefined {
  return project.sequences[sequenceId];
}

export function findTrack(project: Project, sequenceId: SequenceId, trackId: TrackId): TrackLocation | undefined {
  const sequence = project.sequences[sequenceId];
  if (!sequence) return undefined;
  const index = sequence.tracks.findIndex((t) => t.id === trackId);
  if (index < 0) return undefined;
  return { sequence, track: sequence.tracks[index]!, index };
}

export function findClip(project: Project, sequenceId: SequenceId, clipId: ClipId): ClipLocation | undefined {
  const sequence = project.sequences[sequenceId];
  if (!sequence) return undefined;
  for (let trackIndex = 0; trackIndex < sequence.tracks.length; trackIndex++) {
    const track = sequence.tracks[trackIndex]!;
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) {
      return { sequence, track, clip: track.clips[clipIndex]!, trackIndex, clipIndex };
    }
  }
  return undefined;
}

/** All clips in the project, in sequence/track order. */
export function allClips(project: Project): { sequence: Sequence; track: Track; clip: Track['clips'][number] }[] {
  const out: { sequence: Sequence; track: Track; clip: Track['clips'][number] }[] = [];
  for (const sequence of Object.values(project.sequences)) {
    for (const track of sequence.tracks) {
      for (const clip of track.clips) out.push({ sequence, track, clip });
    }
  }
  return out;
}

export function clipIdExists(project: Project, clipId: ClipId): boolean {
  return allClips(project).some(({ clip }) => clip.id === clipId);
}

/** Sort a track's clips by start time (stable for equal starts). */
export function sortTrackClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
}
import {
  DEFAULT_CLIP_AUDIO,
  DEFAULT_TRANSFORM,
  newAssetId,
  newClipId,
  newId,
  type Asset,
  type AssetId,
  type AssetSource,
  type CaptionClip,
  type CaptionSegment,
  type ClipAudio,
  type ColorClip,
  type Crop,
  type Effect,
  type GenerationProvenance,
  type MediaClip,
  type MediaInfo,
  type Project,
  type ProjectId,
  type TextClip,
  type TextStyle,
  type TrackId,
  type Transition,
} from '@openvideomaker/schema';

/** Convenience builders producing schema-valid entity drafts with fresh ids. */

export interface MediaClipDraft {
  id?: MediaClip['id'];
  trackId: TrackId;
  start: number;
  duration: number;
  assetId: AssetId;
  inPoint?: number;
  speed?: number;
  enabled?: boolean;
  opacity?: number;
  transform?: Partial<MediaClip['transform']>;
  crop?: Crop | null;
  audio?: ClipAudio | null;
  effects?: Effect[];
  transitionIn?: Transition | null;
  transitionOut?: Transition | null;
  linkedClipId?: MediaClip['linkedClipId'];
  provenance?: GenerationProvenance | null;
}

export function mediaClip(draft: MediaClipDraft): MediaClip {
  return {
    kind: 'media',
    id: draft.id ?? newClipId(),
    trackId: draft.trackId,
    start: draft.start,
    duration: draft.duration,
    assetId: draft.assetId,
    inPoint: draft.inPoint ?? 0,
    speed: draft.speed ?? 1,
    enabled: draft.enabled ?? true,
    opacity: draft.opacity ?? 1,
    transform: { ...DEFAULT_TRANSFORM, ...(draft.transform ?? {}) },
    crop: draft.crop ?? null,
    audio: draft.audio === undefined ? null : draft.audio,
    effects: draft.effects ?? [],
    transitionIn: draft.transitionIn ?? null,
    transitionOut: draft.transitionOut ?? null,
    linkedClipId: draft.linkedClipId ?? null,
    provenance: draft.provenance ?? null,
  };
}

export interface TextClipDraft {
  id?: TextClip['id'];
  trackId: TrackId;
  start: number;
  duration: number;
  content: string;
  style?: Partial<TextStyle>;
  enabled?: boolean;
  opacity?: number;
}

export function textClip(draft: TextClipDraft): TextClip {
  return {
    kind: 'text',
    id: draft.id ?? newClipId(),
    trackId: draft.trackId,
    start: draft.start,
    duration: draft.duration,
    content: draft.content,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 64,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'center',
      positionX: 0.5,
      positionY: 0.5,
      ...(draft.style ?? {}),
    },
    speed: 1,
    enabled: draft.enabled ?? true,
    opacity: draft.opacity ?? 1,
    transform: { ...DEFAULT_TRANSFORM },
    crop: null,
    audio: null,
    effects: [],
    transitionIn: null,
    transitionOut: null,
    linkedClipId: null,
    provenance: null,
  };
}

export interface CaptionClipDraft {
  id?: CaptionClip['id'];
  trackId: TrackId;
  start: number;
  duration: number;
  segments: CaptionSegment[];
  enabled?: boolean;
}

export function captionClip(draft: CaptionClipDraft): CaptionClip {
  return {
    kind: 'caption',
    id: draft.id ?? newClipId(),
    trackId: draft.trackId,
    start: draft.start,
    duration: draft.duration,
    segments: draft.segments,
    speed: 1,
    enabled: draft.enabled ?? true,
    opacity: 1,
    transform: { ...DEFAULT_TRANSFORM },
    crop: null,
    audio: null,
    effects: [],
    transitionIn: null,
    transitionOut: null,
    linkedClipId: null,
    provenance: null,
  };
}

export interface ColorClipDraft {
  id?: ColorClip['id'];
  trackId: TrackId;
  start: number;
  duration: number;
  color: string;
}

export function colorClip(draft: ColorClipDraft): ColorClip {
  return {
    kind: 'color',
    id: draft.id ?? newClipId(),
    trackId: draft.trackId,
    start: draft.start,
    duration: draft.duration,
    color: draft.color,
    speed: 1,
    enabled: true,
    opacity: 1,
    transform: { ...DEFAULT_TRANSFORM },
    crop: null,
    audio: null,
    effects: [],
    transitionIn: null,
    transitionOut: null,
    linkedClipId: null,
    provenance: null,
  };
}

export interface ImportedAssetDraft {
  id?: AssetId;
  kind: Asset['kind'];
  name: string;
  path: string;
  media?: MediaInfo;
  importedAt?: string;
}

export function importedAsset(draft: ImportedAssetDraft): Asset {
  return {
    id: draft.id ?? newAssetId(),
    kind: draft.kind,
    name: draft.name,
    source: { kind: 'file', path: draft.path },
    media: draft.media,
    origin: { kind: 'import' },
    importedAt: draft.importedAt ?? new Date().toISOString(),
  };
}

export interface GeneratedAssetDraft {
  id?: AssetId;
  kind: Asset['kind'];
  name: string;
  source: AssetSource;
  media?: MediaInfo;
  capability: string;
  model: { id: string; revision?: string };
  runner: GenerationProvenance['runner'];
  settings?: Record<string, unknown>;
  inputs?: GenerationProvenance['inputs'];
  regenerable?: boolean;
  device?: GenerationProvenance['device'];
  generatedAt?: string;
}

export function generatedAsset(draft: GeneratedAssetDraft): Asset {
  const now = draft.generatedAt ?? new Date().toISOString();
  return {
    id: draft.id ?? newAssetId(),
    kind: draft.kind,
    name: draft.name,
    source: draft.source,
    media: draft.media,
    origin: {
      kind: 'generated',
      provenance: {
        capability: draft.capability,
        model: draft.model,
        runner: draft.runner,
        settings: draft.settings ?? {},
        inputs: draft.inputs ?? [],
        generatedAt: now,
        regenerable: draft.regenerable ?? false,
        device: draft.device,
      },
    },
    importedAt: now,
  };
}

/** A pristine project shell, used as the replay/undo base and by session.create. */
export function blankProject(projectId: ProjectId): Project {
  return {
    formatVersion: 1,
    id: projectId,
    name: '',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, audioChannels: 2 },
    assets: {},
    characters: {},
    sequences: {},
    activeSequenceId: null,
  };
}
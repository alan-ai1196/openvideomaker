import {
  newAssetId,
  newCharacterId,
  newClipId,
  newEffectId,
  newMarkerId,
  newSequenceId,
  newTrackId,
} from '@openvideomaker/schema';
import type {
  AssetId,
  CharacterId,
  ClipId,
  EffectId,
  MarkerId,
  SequenceId,
  TrackId,
} from '@openvideomaker/schema';
import type {
  AssetImportParams,
  AssetRemoveParams,
  AssetReplaceParams,
  AssetUpdateParams,
  CaptionEditParams,
  CharacterCreateParams,
  CharacterRemoveParams,
  CharacterUpdateParams,
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
  EffectAddParams,
  EffectRemoveParams,
  EffectUpdateParams,
  GenerationCreateParams,
  GenerationRegenerateParams,
  MarkerAddParams,
  MarkerRemoveParams,
  ProjectRenameParams,
  ProjectSettingsParams,
  RawOperation,
  SequenceActivateParams,
  SequenceCreateParams,
  SequenceRemoveParams,
  SequenceRenameParams,
  TextEditParams,
  TrackCreateParams,
  TrackEnableParams,
  TrackLockParams,
  TrackMuteParams,
  TrackRemoveParams,
  TrackRenameParams,
  TranscriptCreateParams,
  TranscriptRemoveParams,
  TranscriptSetLanguageParams,
  TranscriptSetSegmentsParams,
  TranscriptSetSegmentTextParams,
  TransitionSetParams,
  VoiceChangeParams,
} from '@openvideomaker/schema';
import type { TranscriptId } from '@openvideomaker/schema';

/**
 * Collects operations for one transaction. Every method maps 1:1 to an
 * operation type; the session applies them atomically with a single
 * base-checkpoint check and a single invariant validation pass.
 */
export class TransactionScope {
  #operations: RawOperation[] = [];

  get operations(): RawOperation[] {
    return [...this.#operations];
  }

  /** Push any operation directly (typed by the schema's RawOperation union). */
  push(operation: RawOperation): void {
    this.#operations.push(operation);
  }

  /** Applies 'project.rename'. */
  renameProject(params: ProjectRenameParams): void {
    this.push({ type: 'project.rename', params });
  }

  /** Applies 'project.settings'. */
  setProjectSettings(params: ProjectSettingsParams): void {
    this.push({ type: 'project.settings', params });
  }

  /** Applies 'sequence.create'. */
  createSequence(params: SequenceCreateParams): SequenceId {
    this.push({ type: 'sequence.create', params });
    return params.sequenceId;
  }

  /** Applies 'sequence.remove'. */
  removeSequence(params: SequenceRemoveParams): void {
    this.push({ type: 'sequence.remove', params });
  }

  /** Applies 'sequence.rename'. */
  renameSequence(params: SequenceRenameParams): void {
    this.push({ type: 'sequence.rename', params });
  }

  /** Applies 'sequence.activate'. */
  activateSequence(params: SequenceActivateParams): void {
    this.push({ type: 'sequence.activate', params });
  }

  /** Applies 'track.create'. */
  createTrack(params: TrackCreateParams): TrackId {
    this.push({ type: 'track.create', params });
    return params.trackId;
  }

  /** Applies 'track.remove'. */
  removeTrack(params: TrackRemoveParams): void {
    this.push({ type: 'track.remove', params });
  }

  /** Applies 'track.rename'. */
  renameTrack(params: TrackRenameParams): void {
    this.push({ type: 'track.rename', params });
  }

  /** Applies 'track.enable'. */
  enableTrack(params: TrackEnableParams): void {
    this.push({ type: 'track.enable', params });
  }

  /** Applies 'track.lock'. */
  lockTrack(params: TrackLockParams): void {
    this.push({ type: 'track.lock', params });
  }

  /** Applies 'track.mute'. */
  muteTrack(params: TrackMuteParams): void {
    this.push({ type: 'track.mute', params });
  }

  /** Applies 'clip.insert'. */
  insertClip(params: ClipInsertParams): ClipId {
    this.push({ type: 'clip.insert', params });
    return params.clip.id;
  }

  /** Applies 'clip.remove'. */
  removeClip(params: ClipRemoveParams): void {
    this.push({ type: 'clip.remove', params });
  }

  /** Applies 'clip.move'. */
  moveClip(params: ClipMoveParams): void {
    this.push({ type: 'clip.move', params });
  }

  /** Applies 'clip.trim'. */
  trimClip(params: ClipTrimParams): void {
    this.push({ type: 'clip.trim', params });
  }

  /** Applies 'clip.split'. */
  splitClip(params: ClipSplitParams): ClipId {
    this.push({ type: 'clip.split', params });
    return params.leftClipId;
  }

  /** Applies 'clip.transform'. */
  transformClip(params: ClipTransformParams): void {
    this.push({ type: 'clip.transform', params });
  }

  /** Applies 'clip.opacity'. */
  setClipOpacity(params: ClipOpacityParams): void {
    this.push({ type: 'clip.opacity', params });
  }

  /** Applies 'clip.crop'. */
  setClipCrop(params: ClipCropParams): void {
    this.push({ type: 'clip.crop', params });
  }

  /** Applies 'clip.speed'. */
  setClipSpeed(params: ClipSpeedParams): void {
    this.push({ type: 'clip.speed', params });
  }

  /** Applies 'clip.enable'. */
  enableClip(params: ClipEnableParams): void {
    this.push({ type: 'clip.enable', params });
  }

  /** Applies 'clip.audio'. */
  setClipAudio(params: ClipAudioParams): void {
    this.push({ type: 'clip.audio', params });
  }

  /** Applies 'clip.asset'. */
  setClipAsset(params: ClipAssetParams): void {
    this.push({ type: 'clip.asset', params });
  }

  /** Applies 'text.edit'. */
  editText(params: TextEditParams): void {
    this.push({ type: 'text.edit', params });
  }

  /** Applies 'caption.edit'. */
  editCaption(params: CaptionEditParams): void {
    this.push({ type: 'caption.edit', params });
  }

  /** Applies 'effect.add'. */
  addEffect(params: EffectAddParams): EffectId {
    this.push({ type: 'effect.add', params });
    return params.effect.id;
  }

  /** Applies 'effect.remove'. */
  removeEffect(params: EffectRemoveParams): void {
    this.push({ type: 'effect.remove', params });
  }

  /** Applies 'effect.update'. */
  updateEffect(params: EffectUpdateParams): void {
    this.push({ type: 'effect.update', params });
  }

  /** Applies 'transition.set'. */
  setTransition(params: TransitionSetParams): void {
    this.push({ type: 'transition.set', params });
  }

  /** Applies 'marker.add'. */
  addMarker(params: MarkerAddParams): MarkerId {
    this.push({ type: 'marker.add', params });
    return params.marker.id;
  }

  /** Applies 'marker.remove'. */
  removeMarker(params: MarkerRemoveParams): void {
    this.push({ type: 'marker.remove', params });
  }

  /** Applies 'asset.import'. */
  importAsset(params: AssetImportParams): AssetId {
    this.push({ type: 'asset.import', params });
    return params.asset.id;
  }

  /** Applies 'asset.update'. */
  updateAsset(params: AssetUpdateParams): void {
    this.push({ type: 'asset.update', params });
  }

  /** Applies 'asset.remove'. */
  removeAsset(params: AssetRemoveParams): void {
    this.push({ type: 'asset.remove', params });
  }

  /** Applies 'asset.replace'. */
  replaceAsset(params: AssetReplaceParams): void {
    this.push({ type: 'asset.replace', params });
  }

  /** Applies 'character.create'. */
  createCharacter(params: CharacterCreateParams): CharacterId {
    this.push({ type: 'character.create', params });
    return params.character.id;
  }

  /** Applies 'character.update'. */
  updateCharacter(params: CharacterUpdateParams): void {
    this.push({ type: 'character.update', params });
  }

  /** Applies 'character.remove'. */
  removeCharacter(params: CharacterRemoveParams): void {
    this.push({ type: 'character.remove', params });
  }

  /** Applies 'voice.change'. */
  changeVoice(params: VoiceChangeParams): void {
    this.push({ type: 'voice.change', params });
  }

  /** Applies 'generation.create'. */
  createGeneration(params: GenerationCreateParams): AssetId {
    this.push({ type: 'generation.create', params });
    return params.asset.id;
  }

  /** Applies 'generation.regenerate'. */
  regenerateGeneration(params: GenerationRegenerateParams): AssetId {
    this.push({ type: 'generation.regenerate', params });
    return params.newAssetId;
  }

  /** Applies 'transcript.create'. */
  createTranscript(params: TranscriptCreateParams): TranscriptId {
    this.push({ type: 'transcript.create', params });
    return params.transcript.id;
  }

  /** Applies 'transcript.setSegments'. */
  setTranscriptSegments(params: TranscriptSetSegmentsParams): void {
    this.push({ type: 'transcript.setSegments', params });
  }

  /** Applies 'transcript.setSegmentText'. */
  setTranscriptSegmentText(params: TranscriptSetSegmentTextParams): void {
    this.push({ type: 'transcript.setSegmentText', params });
  }

  /** Applies 'transcript.setLanguage'. */
  setTranscriptLanguage(params: TranscriptSetLanguageParams): void {
    this.push({ type: 'transcript.setLanguage', params });
  }

  /** Applies 'transcript.remove'. */
  removeTranscript(params: TranscriptRemoveParams): void {
    this.push({ type: 'transcript.remove', params });
  }

  // ---- id factories (delegate to the schema's generator) ----

  newSequenceId(): SequenceId {
    return newSequenceId();
  }

  newTrackId(): TrackId {
    return newTrackId();
  }

  newClipId(): ClipId {
    return newClipId();
  }

  newAssetId(): AssetId {
    return newAssetId();
  }

  newCharacterId(): CharacterId {
    return newCharacterId();
  }

  newMarkerId(): MarkerId {
    return newMarkerId();
  }

  newEffectId(): EffectId {
    return newEffectId();
  }
}
import type { Operation, OperationType, Project } from '@openvideomaker/schema';
import { OvmError } from '../errors.js';
import type { ApplyFn, ApplyRegistry } from '../types.js';
import { applyAssetImport, applyAssetRemove, applyAssetReplace, applyAssetUpdate } from './asset.js';
import { applyCharacterCreate, applyCharacterRemove, applyCharacterUpdate } from './character.js';
import {
  applyClipAsset,
  applyClipAudio,
  applyClipCrop,
  applyClipEnable,
  applyClipInsert,
  applyClipMove,
  applyClipOpacity,
  applyClipRemove,
  applyClipSpeed,
  applyClipSplit,
  applyClipTransform,
  applyClipTrim,
} from './clip.js';
import { applyEffectAdd, applyEffectRemove, applyEffectUpdate, applyTransitionSet } from './effectTransition.js';
import { applyGenerationCreate, applyGenerationRegenerate } from './generation.js';
import {
  applyTranscriptCreate,
  applyTranscriptRemove,
  applyTranscriptSetLanguage,
  applyTranscriptSetSegments,
  applyTranscriptSetSegmentText,
} from './transcript.js';
import { applyMarkerAdd, applyMarkerRemove } from './marker.js';
import { applyProjectCreate, applyProjectRename, applyProjectSettings } from './project.js';
import { applySequenceActivate, applySequenceCreate, applySequenceRemove, applySequenceRename } from './sequence.js';
import { applyCaptionEdit, applyTextEdit } from './textCaption.js';
import {
  applyTrackCreate,
  applyTrackEnable,
  applyTrackLock,
  applyTrackMute,
  applyTrackRemove,
  applyTrackRename,
} from './track.js';
import { applyVoiceChange } from './voice.js';

const registry = new Map<OperationType, ApplyFn<any>>([
  ['project.create', applyProjectCreate],
  ['project.rename', applyProjectRename],
  ['project.settings', applyProjectSettings],
  ['sequence.create', applySequenceCreate],
  ['sequence.remove', applySequenceRemove],
  ['sequence.rename', applySequenceRename],
  ['sequence.activate', applySequenceActivate],
  ['track.create', applyTrackCreate],
  ['track.remove', applyTrackRemove],
  ['track.rename', applyTrackRename],
  ['track.enable', applyTrackEnable],
  ['track.lock', applyTrackLock],
  ['track.mute', applyTrackMute],
  ['clip.insert', applyClipInsert],
  ['clip.remove', applyClipRemove],
  ['clip.move', applyClipMove],
  ['clip.trim', applyClipTrim],
  ['clip.split', applyClipSplit],
  ['clip.transform', applyClipTransform],
  ['clip.opacity', applyClipOpacity],
  ['clip.crop', applyClipCrop],
  ['clip.speed', applyClipSpeed],
  ['clip.enable', applyClipEnable],
  ['clip.audio', applyClipAudio],
  ['clip.asset', applyClipAsset],
  ['text.edit', applyTextEdit],
  ['caption.edit', applyCaptionEdit],
  ['effect.add', applyEffectAdd],
  ['effect.remove', applyEffectRemove],
  ['effect.update', applyEffectUpdate],
  ['transition.set', applyTransitionSet],
  ['marker.add', applyMarkerAdd],
  ['marker.remove', applyMarkerRemove],
  ['asset.import', applyAssetImport],
  ['asset.update', applyAssetUpdate],
  ['asset.remove', applyAssetRemove],
  ['asset.replace', applyAssetReplace],
  ['character.create', applyCharacterCreate],
  ['character.update', applyCharacterUpdate],
  ['character.remove', applyCharacterRemove],
  ['voice.change', applyVoiceChange],
  ['generation.create', applyGenerationCreate],
  ['generation.regenerate', applyGenerationRegenerate],
  ['transcript.create', applyTranscriptCreate],
  ['transcript.setSegments', applyTranscriptSetSegments],
  ['transcript.setSegmentText', applyTranscriptSetSegmentText],
  ['transcript.setLanguage', applyTranscriptSetLanguage],
  ['transcript.remove', applyTranscriptRemove],
]);

/**
 * The single authoritative dispatch point for every project mutation.
 * Studio, MCP, SDK, CLI and agents all mutate projects through here.
 */
export const applyRegistry: ApplyRegistry = {
  has(type: OperationType): boolean {
    return registry.has(type);
  },
  apply(project: Project, op: Operation, now: string): void {
    const fn = registry.get(op.type);
    if (!fn) throw new OvmError('op.validation', 'unsupported operation: ' + op.type);
    fn(project, op.params, { opId: op.opId, actor: op.actor, now });
    project.updatedAt = now;
  },
};

export function applyOperation(project: Project, op: Operation, now: string): void {
  applyRegistry.apply(project, op, now);
}
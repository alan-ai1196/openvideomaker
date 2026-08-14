import type { ProjectSettings, ScriptId, SequenceId, TrackId, TrackKind } from '@openvideomaker/schema';
import { newScriptId, newTrackId } from '@openvideomaker/schema';
import { ProjectSession } from './session.js';

/**
 * Product templates: creation presets that build ORDINARY editable
 * Video IR structures - settings, tracks and script documents through
 * the standard typed operations. After applying a template the project
 * is not in any special locked mode; every piece is a normal track,
 * clip or script that the user (or an agent) can edit, and the whole
 * apply is one undoable, replay-deterministic transaction.
 */

export type TemplateId = 'talking-video' | 'auto-dub' | 'podcast-clips' | 'vertical-short' | 'blank';

export interface ProjectTemplate {
  id: TemplateId;
  name: string;
  description: string;
  /** Composition settings to apply (partial patch). */
  settings: Partial<ProjectSettings>;
  /** Tracks to create (kind + name), in timeline order. */
  tracks: Array<{ kind: TrackKind; name: string }>;
  /** Scripts to create (empty document; the creator writes the lines). */
  scripts: string[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'talking-video',
    name: 'Talking Video',
    description: 'A presenter video: video, voiceover audio and caption tracks plus a script to speak from.',
    settings: { width: 1920, height: 1080 },
    tracks: [
      { kind: 'video', name: 'Main' },
      { kind: 'audio', name: 'Voiceover' },
      { kind: 'caption', name: 'Captions' },
    ],
    scripts: ['Talking Video script'],
  },
  {
    id: 'auto-dub',
    name: 'Auto Dub',
    description: 'Dub a video into another language: the source video, a replacement dub track and captions.',
    settings: { width: 1920, height: 1080 },
    tracks: [
      { kind: 'video', name: 'Source' },
      { kind: 'audio', name: 'Dub' },
      { kind: 'caption', name: 'Captions' },
    ],
    scripts: ['Dub script'],
  },
  {
    id: 'podcast-clips',
    name: 'Podcast Clips',
    description: 'Turn a recording into shareable square clips: audio, captions and title text.',
    settings: { width: 1080, height: 1080 },
    tracks: [
      { kind: 'audio', name: 'Recording' },
      { kind: 'caption', name: 'Captions' },
      { kind: 'text', name: 'Titles' },
    ],
    scripts: [],
  },
  {
    id: 'vertical-short',
    name: 'Vertical Short',
    description: 'A 9:16 short: one video track and captions, sized for phone screens.',
    settings: { width: 1080, height: 1920 },
    tracks: [
      { kind: 'video', name: 'Main' },
      { kind: 'caption', name: 'Captions' },
    ],
    scripts: [],
  },
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'A clean 1080p canvas with one video and one audio track.',
    settings: { width: 1920, height: 1080 },
    tracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'audio', name: 'A1' },
    ],
    scripts: [],
  },
];

export interface ApplyTemplateResult {
  templateId: TemplateId;
  sequenceId: SequenceId;
  trackIds: TrackId[];
  scriptIds: ScriptId[];
}

/**
 * Apply a template to the project's active sequence in ONE transaction.
 * 'blank' replaces the sequence's tracks with the clean defaults
 * (removal + recreation in the same transaction, fully undoable); every
 * other template ADDS its tracks/scripts without touching existing
 * content - templates are starting points, not destructive resets.
 */
export function applyProjectTemplate(session: ProjectSession, templateId: TemplateId): ApplyTemplateResult | null {
  const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const sequenceId = (session.project.activeSequenceId ?? (Object.keys(session.project.sequences)[0] as SequenceId | undefined)) as SequenceId | undefined;
  if (!sequenceId) return null;
  const trackIds: TrackId[] = [];
  const scriptIds: ScriptId[] = [];
  session.transaction((tx) => {
    tx.setProjectSettings({ settings: template.settings });
    if (templateId === 'blank') {
      for (const track of session.project.sequences[sequenceId]?.tracks ?? []) {
        tx.removeTrack({ sequenceId, trackId: track.id });
      }
    }
    for (const track of template.tracks) {
      const trackId = tx.newTrackId();
      tx.createTrack({ sequenceId, trackId, kind: track.kind, name: track.name });
      trackIds.push(trackId);
    }
    for (const name of template.scripts) {
      const scriptId = newScriptId();
      tx.createScript({
        script: {
          id: scriptId,
          name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lines: [],
        },
      });
      scriptIds.push(scriptId);
    }
  });
  return { templateId, sequenceId, trackIds, scriptIds };
}

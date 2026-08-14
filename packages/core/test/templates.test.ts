import { describe, expect, it } from 'vitest';
import { applyProjectTemplate, PROJECT_TEMPLATES } from '@openvideomaker/core';
import { setupSession } from './helpers';

describe('product templates', () => {
  it('applies a vertical-short template: settings + tracks in one transaction', () => {
    const { session } = setupSession();
    const anchor = session.checkpoint;
    const result = applyProjectTemplate(session, 'vertical-short');
    expect(result?.trackIds).toHaveLength(2);
    expect(session.project.settings.width).toBe(1080);
    expect(session.project.settings.height).toBe(1920);
    const tracks = session.project.sequences[result!.sequenceId]?.tracks ?? [];
    expect(tracks.some((t) => t.kind === 'caption' && t.name === 'Captions')).toBe(true);
    expect(tracks.some((t) => t.kind === 'video' && t.name === 'Main')).toBe(true);
    // Fully undoable: walk back to the anchor.
    while (session.checkpoint > anchor) session.undo();
    expect(session.project.settings.width).toBe(1920);
    expect(session.project.sequences[result!.sequenceId]?.tracks).toHaveLength(0);
    // And replay-forward deterministically.
    while (session.canRedo) session.redo();
    expect(session.project.settings.width).toBe(1080);
    expect(session.project.sequences[result!.sequenceId]?.tracks).toHaveLength(2);
  });

  it('creates the script document for talking-video', () => {
    const { session } = setupSession();
    const result = applyProjectTemplate(session, 'talking-video');
    expect(result?.scriptIds).toHaveLength(1);
    const script = session.project.scripts[result!.scriptIds[0]!];
    expect(script?.name).toBe('Talking Video script');
    expect(script?.lines).toEqual([]);
    const tracks = session.project.sequences[result!.sequenceId]?.tracks ?? [];
    expect(tracks.map((t) => t.kind)).toContain('audio');
    expect(tracks.map((t) => t.kind)).toContain('caption');
  });

  it('blank replaces the active sequence tracks, undoably', () => {
    const { session } = setupSession();
    const activeId = session.project.activeSequenceId!;
    const result = applyProjectTemplate(session, 'blank');
    const tracks = session.project.sequences[result!.sequenceId]?.tracks ?? [];
    expect(tracks.map((t) => t.name)).toEqual(['V1', 'A1']);
    expect(result?.sequenceId).toBe(activeId);
    const anchor = session.checkpoint;
    const nonBlank = applyProjectTemplate(session, 'vertical-short');
    while (session.checkpoint > anchor) session.undo();
    expect(session.project.sequences[result!.sequenceId]?.tracks.map((t) => t.name)).toEqual(['V1', 'A1']);
    expect(nonBlank?.trackIds).toHaveLength(2);
  });

  it('returns null for unknown template ids', () => {
    const { session } = setupSession();
    expect(applyProjectTemplate(session, 'not-a-template' as never)).toBeNull();
  });

  it('declares every template with tracks and a description', () => {
    expect(PROJECT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const template of PROJECT_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.tracks.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ProjectSession, syncTextClipsFromScript } from '@openvideomaker/core';
import { newLineId, newScriptId, type Script } from '@openvideomaker/schema';

function makeScript(name = 'Intro script'): Script {
  const now = new Date().toISOString();
  return {
    id: newScriptId(),
    name,
    lines: [
      { id: newLineId(), text: 'Hello and welcome.' },
      { id: newLineId(), text: 'Today we make a video.' },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function makeSession(): ProjectSession {
  return ProjectSession.create('Script Test', { settings: { width: 1280, height: 720 } });
}

describe('script operations', () => {
  it('creates, renames, edits lines and removes scripts', () => {
    const session = makeSession();
    const script = makeScript();
    session.transaction((tx) => tx.createScript({ script }));
    expect(session.project.scripts[script.id]?.lines).toHaveLength(2);

    session.transaction((tx) => {
      tx.renameScript({ scriptId: script.id, name: 'Final script' });
      tx.updateScriptLine({ scriptId: script.id, lineId: script.lines[0]!.id, patch: { text: 'Hello and welcome back.' } });
      tx.updateScriptLine({ scriptId: script.id, lineId: script.lines[0]!.id, patch: { startUs: 2_000_000, durationUs: 3_000_000 } });
    });
    expect(session.project.scripts[script.id]?.name).toBe('Final script');
    expect(session.project.scripts[script.id]?.lines[0]?.text).toBe('Hello and welcome back.');
    expect(session.project.scripts[script.id]?.lines[0]?.startUs).toBe(2_000_000);

    session.transaction((tx) => tx.removeScriptLine({ scriptId: script.id, lineId: script.lines[1]!.id }));
    expect(session.project.scripts[script.id]?.lines).toHaveLength(1);
    session.undo();
    expect(session.project.scripts[script.id]?.lines).toHaveLength(2);

    session.transaction((tx) => tx.removeScript({ scriptId: script.id }));
    expect(session.project.scripts[script.id]).toBeUndefined();
  });

  it('rejects edits to missing scripts and lines', () => {
    const session = makeSession();
    expect(() => session.transaction((tx) => tx.renameScript({ scriptId: newScriptId(), name: 'x' }))).toThrow(/script not found/);
    const script = makeScript();
    session.transaction((tx) => tx.createScript({ script }));
    expect(() => session.transaction((tx) => tx.updateScriptLine({ scriptId: script.id, lineId: newLineId(), patch: { text: 'x' } }))).toThrow(/line not found/);
  });
});

describe('syncTextClipsFromScript', () => {
  it('places untimed lines sequentially and timed lines exactly', () => {
    const session = makeSession();
    const script = makeScript();
    session.transaction((tx) => tx.createScript({ script }));
    // Line 1 gets explicit timing; line 2 stays untimed (follows line 1).
    session.transaction((tx) => {
      tx.updateScriptLine({ scriptId: script.id, lineId: script.lines[0]!.id, patch: { startUs: 5_000_000, durationUs: 2_000_000 } });
    });
    const sync = syncTextClipsFromScript(session, { scriptId: script.id });
    expect(sync?.clipCount).toBe(2);
    const sequenceId = Object.keys(session.project.sequences)[0]!;
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'text' && t.name === 'Script');
    expect(track?.clips[0]?.start).toBe(5_000_000);
    expect(track?.clips[0]?.duration).toBe(2_000_000);
    expect(track?.clips[1]?.start).toBe(7_000_000);
  });

  it('is idempotent and undoable as one transaction', () => {
    const session = makeSession();
    const script = makeScript();
    session.transaction((tx) => tx.createScript({ script }));
    syncTextClipsFromScript(session, { scriptId: script.id });
    const again = syncTextClipsFromScript(session, { scriptId: script.id });
    expect(again?.clipCount).toBe(2);
    const sequenceId = Object.keys(session.project.sequences)[0]!;
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'text');
    expect(track?.clips).toHaveLength(2);
    // Undo is per operation: sync #1 (create+2 inserts) and sync #2
    // (2 removes+2 inserts) are 7 operations total.
    for (let i = 0; i < 7; i++) session.undo();
    const afterAll = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'text');
    expect(afterAll).toBeUndefined();
  });
});

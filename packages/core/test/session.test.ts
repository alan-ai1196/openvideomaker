import { describe, expect, it } from 'vitest';
import { ConflictError, InvariantError, OvmError, ProjectSession } from '@openvideomaker/core';
import { mediaClip, setupSession, setupSessionWithAsset } from './helpers';

describe('ProjectSession.create', () => {
  it('creates a project with a project.create root operation', () => {
    const session = ProjectSession.create('My Video', { settings: { fps: { num: 24, den: 1 } } });
    expect(session.project.name).toBe('My Video');
    expect(session.project.settings.fps).toEqual({ num: 24, den: 1 });
    expect(session.project.settings.width).toBe(1920);
    expect(session.checkpoint).toBe(2);
    expect(session.log).toHaveLength(1);
    expect(session.log[0]?.operations[0]?.type).toBe('project.create');
    expect(session.log[0]?.operations[1]?.type).toBe('sequence.create');
    expect(Object.keys(session.project.sequences)).toHaveLength(1);
    expect(session.log[0]?.operations[0]?.actor.kind).toBe('user');
  });
});

describe('transactions and checkpointing', () => {
  it('advances the checkpoint once per operation', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const before = session.checkpoint;
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1000 }) });
    });
    expect(session.checkpoint).toBe(before + 1);
    expect(session.project.sequences[sequenceId]?.tracks[0]?.clips).toHaveLength(1);
  });

  it('applies transactions atomically: a mid-transaction failure rolls back everything', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    const before = session.checkpoint;
    expect(() =>
      session.transaction((tx) => {
        tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1000 }) });
        // second clip overlaps the first: invariant violation at commit
        tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 500, duration: 1000 }) });
      }),
    ).toThrow();
    // atomicity: nothing was applied
    expect(session.project.sequences[sequenceId]?.tracks[0]?.clips).toHaveLength(0);
    expect(session.checkpoint).toBe(before);
  });
});

describe('undo / redo', () => {
  it('undoes per operation and redo restores exactly', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1000 }) });
    });
    const before = JSON.stringify(session.project);
    session.transaction((tx) => {
      tx.renameProject({ name: 'Renamed' });
    });
    expect(session.project.name).toBe('Renamed');
    expect(session.undo()).toBe(true);
    expect(session.project.name).toBe('Test Project');
    expect(session.redo()).toBe(true);
    expect(session.project.name).toBe('Renamed');
    expect(session.undo()).toBe(true);
    expect(JSON.stringify(session.project)).toBe(before);
  });

  it('returns false at history boundaries', () => {
    const session = ProjectSession.create('X');
    expect(session.undo()).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.undo()).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.redo()).toBe(true);
    expect(session.redo()).toBe(false);
  });

  it('truncates the redo tail when applying after undo', () => {
    const { session } = setupSession();
    session.transaction((tx) => tx.renameProject({ name: 'A' }));
    session.transaction((tx) => tx.renameProject({ name: 'B' }));
    session.undo();
    session.transaction((tx) => tx.renameProject({ name: 'C' }));
    expect(session.project.name).toBe('C');
    expect(session.redo()).toBe(false);
  });
});

describe('optimistic concurrency', () => {
  it('rejects stale base checkpoints', () => {
    const { session } = setupSession();
    expect(() =>
      session.apply([{ type: 'project.rename', params: { name: 'Stale' } }], { baseCheckpoint: session.checkpoint - 1 }),
    ).toThrow(ConflictError);
    expect(session.project.name).toBe('Test Project');
  });
});

describe('schema validation at the boundary', () => {
  it('rejects malformed operations with a schema error', () => {
    const { session } = setupSession();
    try {
      session.apply([{ type: 'clip.trim', params: { sequenceId: 'nope' } } as never]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OvmError);
      expect((err as OvmError).code).toBe('schema.parse');
    }
  });
});

describe('replay', () => {
  it('reproduces identical state from the exported log', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    session.transaction((tx) => {
      tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1_000_000 }) });
      tx.addMarker({ sequenceId, marker: { id: tx.newMarkerId(), time: 500_000, name: 'cut' } });
    });
    const replayed = ProjectSession.fromLog(session.exportLog());
    expect(replayed.checkpoint).toBe(session.checkpoint);
    expect(JSON.stringify(replayed.project)).toBe(JSON.stringify(session.project));
  });

  it('rejects a log that does not start with project.create', () => {
    expect(() => ProjectSession.fromLog([])).toThrow(/project.create/);
  });
});

describe('invariants after transactions', () => {
  it('rejects overlapping clips on the same track', () => {
    const { session, sequenceId, trackId, asset } = setupSessionWithAsset();
    expect(() =>
      session.transaction((tx) => {
        tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 2_000_000 }) });
        tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 1_000_000, duration: 2_000_000 }) });
      }),
    ).toThrow(InvariantError);
  });

  it('rejects a project with no sequences via fromLog', () => {
    const session = ProjectSession.create('NoSeq');
    const log = session.exportLog();
    log[0] = { ...log[0]!, operations: [log[0]!.operations[0]!] };
    expect(() => ProjectSession.fromLog(log)).toThrow(InvariantError);
  });
});
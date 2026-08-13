import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newProjectId } from '@openvideomaker/schema';
import { importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import { ProjectStore, StoreError } from '@openvideomaker/persistence';

function tmpProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'ovm-store-'));
}

function makeSession() {
  const session = ProjectSession.create('Stored Project');
  const sequenceId = Object.keys(session.project.sequences)[0]!;
  let trackId = '';
  const asset = importedAsset({ kind: 'video', name: 'a.mp4', path: 'C:/media/a.mp4', media: { durationUs: 30_000_000, hasVideo: true, hasAudio: true, width: 1920, height: 1080 } });
  session.transaction((tx) => {
    tx.importAsset({ asset });
    trackId = tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video' });
    tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1_000_000 }) });
  });
  return { session, sequenceId, trackId };
}

describe('ProjectStore lifecycle', () => {
  it('creates the project layout', () => {
    const dir = tmpProjectDir();
    const store = ProjectStore.create(dir, newProjectId());
    expect(existsSync(join(dir, 'meta.json'))).toBe(true);
    expect(existsSync(join(dir, 'store.sqlite'))).toBe(true);
    expect(existsSync(join(dir, 'assets'))).toBe(true);
    expect(existsSync(join(dir, 'proxies'))).toBe(true);
    expect(existsSync(join(dir, 'generated'))).toBe(true);
    expect(existsSync(join(dir, 'cache'))).toBe(true);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to create over an existing project', () => {
    const dir = tmpProjectDir();
    const store = ProjectStore.create(dir, newProjectId());
    store.close();
    expect(() => ProjectStore.create(dir, newProjectId())).toThrow(StoreError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open a folder that is not a project', () => {
    const dir = tmpProjectDir();
    expect(() => ProjectStore.open(dir)).toThrow(/no OpenVideoMaker project/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('save / load round trips', () => {
  it('restores project, log and checkpoint exactly', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    store.close();

    const reopened = ProjectStore.open(dir);
    const loaded = reopened.load();
    expect(JSON.stringify(loaded.project)).toBe(JSON.stringify(session.project));
    expect(JSON.stringify(loaded.log)).toBe(JSON.stringify(session.exportLog()));
    expect(loaded.checkpoint).toBe(session.checkpoint);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends only the new tail on incremental saves', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    session.transaction((tx) => tx.renameProject({ name: 'Renamed' }));
    const result = store.save(session.project, session.exportLog());
    expect(result.appended).toBe(1);
    store.close();

    const reopened = ProjectStore.open(dir);
    const loaded = reopened.load();
    expect(loaded.project.name).toBe('Renamed');
    expect(loaded.checkpoint).toBe(session.checkpoint);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a log that diverges from stored history', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    const tampered = session.exportLog();
    tampered[0] = { ...tampered[0]!, txId: 'tx_ffffffffffffffffffffffff' as never };
    expect(() => store.save(session.project, tampered)).toThrow(/diverges/);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('snapshot and replay behavior', () => {
  it('replays the log tail over an older snapshot', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    // Force a snapshot immediately.
    store.save(session.project, session.exportLog(), { snapshotEveryOps: 0 });
    session.transaction((tx) => tx.renameProject({ name: 'After Snapshot' }));
    session.transaction((tx) => tx.renameProject({ name: 'Final Name' }));
    store.save(session.project, session.exportLog());
    store.close();

    const reopened = ProjectStore.open(dir);
    const loaded = reopened.load();
    expect(loaded.project.name).toBe('Final Name');
    expect(loaded.checkpoint).toBe(session.checkpoint);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rebuilds from the full log when the snapshot is corrupted', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog(), { snapshotEveryOps: 0 });
    store.close();

    const db = new Database(join(dir, 'store.sqlite'));
    db.prepare('UPDATE snapshot SET project_json = ? WHERE id = 1').run('{not json');
    db.close();

    const reopened = ProjectStore.open(dir);
    const loaded = reopened.load();
    expect(JSON.stringify(loaded.project)).toBe(JSON.stringify(session.project));
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('compact() folds history into the snapshot and still loads', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    store.compact();
    const loaded = store.load();
    expect(JSON.stringify(loaded.project)).toBe(JSON.stringify(session.project));
    expect(loaded.log).toHaveLength(0);
    expect(loaded.checkpoint).toBe(session.checkpoint);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('portability and durability', () => {
  it('survives relocation to a path with spaces', () => {
    const dir = tmpProjectDir();
    const { session } = makeSession();
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    store.close();

    const moved = join(tmpdir(), 'ovm-moved project folder ' + Date.now());
    cpSync(dir, moved, { recursive: true });
    const reopened = ProjectStore.open(moved);
    const loaded = reopened.load();
    expect(loaded.project.name).toBe('Stored Project');
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(moved, { recursive: true, force: true });
  });

  it('load fails loudly on an empty store', () => {
    const dir = tmpProjectDir();
    const store = ProjectStore.create(dir, newProjectId());
    expect(() => store.load()).toThrow(/no transactions/);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ProjectSchema,
  TransactionSchema,
  type Project,
  type ProjectId,
  type ProjectLog,
  type Transaction,
} from '@openvideomaker/schema';
import {
  InvariantError,
  SchemaError,
  applyOperation,
  blankProject,
  collectViolations,
  deepFreeze,
} from '@openvideomaker/core';
import { StoreError } from './errors.js';
import { createLayout, metaPath, storePath, type ProjectMeta } from './layout.js';

export interface LoadResult {
  project: Readonly<Project>;
  log: ProjectLog;
  checkpoint: number;
}

export interface SaveOptions {
  /** Rewrite the load-accelerating snapshot every N operations. Default 1000. */
  snapshotEveryOps?: number;
}
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (',
  '  key TEXT PRIMARY KEY,',
  '  value TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS snapshot (',
  '  id INTEGER PRIMARY KEY CHECK (id = 1),',
  '  revision INTEGER NOT NULL,',
  '  project_json TEXT NOT NULL,',
  '  written_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS transactions (',
  '  seq INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  tx_id TEXT NOT NULL UNIQUE,',
  '  tx_json TEXT NOT NULL',
  ');',
].join('\n');

function freeze<T>(value: T): T {
  return deepFreeze(value);
}

/**
 * Durable project store: one SQLite file holding an optional fast-load
 * snapshot plus the complete append-only operation log. The log is the
 * authoritative truth; the snapshot is a cache. Saves are single SQLite
 * transactions (crash-safe), and loads rebuild state by replaying the
 * log tail over the snapshot - so partial writes and torn states are
 * detected and repaired rather than silently trusted.
 */
export class ProjectStore {
  readonly dir: string;
  readonly projectId: ProjectId;
  #db: Database.Database;
  #closed = false;

  private constructor(dir: string, projectId: ProjectId, db: Database.Database) {
    this.dir = dir;
    this.projectId = projectId;
    this.#db = db;
  }

  /** Create a new project folder layout and store. */
  static create(dir: string, projectId: ProjectId): ProjectStore {
    if (existsSync(metaPath(dir))) {
      throw new StoreError('store.not-a-project', 'a project already exists at ' + dir);
    }
    createLayout(dir);
    const meta: ProjectMeta = {
      formatVersion: 1,
      projectId,
      createdAt: new Date().toISOString(),
      app: 'openvideomaker',
    };
    writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    const db = new Database(storePath(dir));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(1));
    return new ProjectStore(dir, projectId, db);
  }

  /** Open an existing project folder. */
  static open(dir: string): ProjectStore {
    if (!existsSync(metaPath(dir)) || !existsSync(storePath(dir))) {
      throw new StoreError('store.not-a-project', 'no OpenVideoMaker project found at ' + dir);
    }
    let meta: ProjectMeta;
    try {
      meta = JSON.parse(readFileSync(metaPath(dir), 'utf8')) as ProjectMeta;
    } catch (err) {
      throw new StoreError('store.corrupt', 'project meta.json is unreadable: ' + (err as Error).message, err);
    }
    if (meta.formatVersion !== 1) {
      throw new StoreError('store.version', 'unsupported project format version: ' + String(meta.formatVersion));
    }
    const db = new Database(storePath(dir));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    if (version?.value !== '1') {
      db.close();
      throw new StoreError('store.version', 'unsupported store schema version: ' + String(version?.value));
    }
    return new ProjectStore(dir, meta.projectId as ProjectId, db);
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Fast path: latest stored snapshot (no replay). May be undefined. */
  latestSnapshot(): Readonly<Project> | undefined {
    this.#assertOpen();
    const row = this.#db.prepare('SELECT project_json, revision FROM snapshot WHERE id = 1').get() as
      | { project_json: string; revision: number }
      | undefined;
    if (!row) return undefined;
    try {
      return freeze(ProjectSchema.parse(JSON.parse(row.project_json)));
    } catch {
      return undefined;
    }
  }

  /**
   * Persist a project state and its full change log. Transactions already
   * stored are matched by id; only the new tail is appended, atomically.
   */
  save(project: Project, log: ProjectLog, options: SaveOptions = {}): { appended: number } {
    this.#assertOpen();
    let parsedProject: Project;
    try {
      parsedProject = ProjectSchema.parse(project);
    } catch (err) {
      throw new SchemaError('invalid project: ' + (err as Error).message, [err]);
    }
    if (parsedProject.id !== this.projectId) {
      throw new StoreError('store.diverged', 'project id does not match the store');
    }
    const parsedLog = log.map((tx) => {
      try {
        return TransactionSchema.parse(tx);
      } catch (err) {
        throw new SchemaError('invalid transaction: ' + (err as Error).message, [err]);
      }
    });
    const stored = this.#db.prepare('SELECT tx_id, tx_json FROM transactions ORDER BY seq').all() as {
      tx_id: string;
      tx_json: string;
    }[];
    // The stored log must be a prefix of the incoming log.
    for (let i = 0; i < stored.length; i += 1) {
      const incoming = parsedLog[i];
      if (!incoming || incoming.txId !== stored[i]!.tx_id) {
        throw new StoreError(
          'store.diverged',
          'incoming log diverges from the stored log at index ' + i + ' - refusing to rewrite history',
        );
      }
    }
    const tail = parsedLog.slice(stored.length);
    const checkpoint = parsedLog.reduce((n, tx) => n + tx.operations.length, 0);

    const snapshotEvery = options.snapshotEveryOps ?? 1000;
    const current = this.#db.prepare('SELECT revision FROM snapshot WHERE id = 1').get() as { revision: number } | undefined;
    const needsSnapshot = !current || checkpoint - current.revision >= snapshotEvery;

    const insert = this.#db.prepare('INSERT INTO transactions (tx_id, tx_json) VALUES (?, ?)');
    const upsert = this.#db.prepare([
      'INSERT INTO snapshot (id, revision, project_json, written_at) VALUES (1, ?, ?, ?)',
      'ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, project_json = excluded.project_json, written_at = excluded.written_at',
    ].join(' '));
    const now = new Date().toISOString();
    this.#db.transaction(() => {
      for (const tx of tail) insert.run(tx.txId, JSON.stringify(tx));
      if (needsSnapshot) upsert.run(checkpoint, JSON.stringify(parsedProject), now);
    })();
    return { appended: tail.length };
  }

  /** Load the project: snapshot + replay of the log tail, fully verified. */
  load(): LoadResult {
    this.#assertOpen();
    const rows = this.#db.prepare('SELECT tx_id, tx_json FROM transactions ORDER BY seq').all() as {
      tx_id: string;
      tx_json: string;
    }[];
    const log: Transaction[] = rows.map((row) => {
      try {
        return TransactionSchema.parse(JSON.parse(row.tx_json));
      } catch (err) {
        throw new StoreError('store.corrupt', 'stored transaction is invalid: ' + (err as Error).message, err);
      }
    });
    const snap = this.#db.prepare('SELECT revision, project_json FROM snapshot WHERE id = 1').get() as
      | { revision: number; project_json: string }
      | undefined;

    if (log.length === 0) {
      // Compacted store: the snapshot is the whole truth.
      if (snap) {
        let snapshotProject: Project;
        try {
          snapshotProject = ProjectSchema.parse(JSON.parse(snap.project_json));
        } catch (err) {
          throw new StoreError('store.corrupt', 'compacted store has an invalid snapshot: ' + (err as Error).message, err);
        }
        if (snapshotProject.id !== this.projectId) {
          throw new StoreError('store.corrupt', 'snapshot project id does not match the store');
        }
        const violations = collectViolations(snapshotProject);
        if (violations.length > 0) {
          throw new InvariantError('stored project is invalid', violations);
        }
        return { project: freeze(snapshotProject), log: [], checkpoint: snap.revision };
      }
      throw new StoreError('store.empty', 'store has no transactions and no snapshot - save a session first');
    }
    const first = log[0]!.operations[0];
    if (!first || first.type !== 'project.create') {
      throw new StoreError('store.corrupt', 'store log does not start with project.create');
    }

    let project: Project = blankProject(first.params.projectId);
    let baseRevision = 0;
    if (snap) {
      try {
        project = ProjectSchema.parse(JSON.parse(snap.project_json));
        baseRevision = snap.revision;
      } catch {
        // Torn or corrupt snapshot: rebuild from the full log instead.
        project = blankProject(first.params.projectId);
        baseRevision = 0;
      }
    }
    const allOps = log.flatMap((tx) => tx.operations);
    let applied = baseRevision;
    for (const op of allOps.slice(baseRevision)) {
      applyOperation(project, op, op.at);
      applied += 1;
    }
    if (project.id !== this.projectId) {
      throw new StoreError('store.corrupt', 'replayed project id does not match the store');
    }
    const violations = collectViolations(project);
    if (violations.length > 0) {
      throw new InvariantError('stored project is invalid after replay', violations);
    }
    return { project: freeze(project), log, checkpoint: applied };
  }

  /**
   * Fold the whole log into the snapshot and drop stored transactions
   * (explicit opt-in; history is otherwise preserved forever).
   */
  compact(): void {
    this.#assertOpen();
    const loaded = this.load();
    const now = new Date().toISOString();
    this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM transactions').run();
      this.#db.prepare([
        'INSERT INTO snapshot (id, revision, project_json, written_at) VALUES (1, ?, ?, ?)',
        'ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, project_json = excluded.project_json, written_at = excluded.written_at',
      ].join(' ')).run(loaded.checkpoint, JSON.stringify(loaded.project), now);
    })();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new StoreError('store.busy', 'store is closed');
  }
}
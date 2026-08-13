import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A project is a folder (by convention named <name>.ovm/) containing:
 *
 *   meta.json     - quick identity/manifest (project id, format version)
 *   store.sqlite  - snapshot + append-only operation log (the durable truth)
 *   assets/       - source media registered as files (not in the DB)
 *   proxies/      - generated proxy media for preview
 *   generated/    - AI-generated artifacts
 *   cache/        - expendable caches (safe to delete)
 *
 * Binary media stays on the filesystem; SQLite holds structured state.
 * Everything is relative to the folder, so the whole project is portable
 * (rename/move/copy/archive) - absolute paths are never identity.
 */
export const META_FILE = 'meta.json';
export const STORE_FILE = 'store.sqlite';
export const MEDIA_DIRS = ['assets', 'proxies', 'generated', 'cache'] as const;
export type MediaDir = (typeof MEDIA_DIRS)[number];

export interface ProjectMeta {
  formatVersion: 1;
  projectId: string;
  createdAt: string;
  app: 'openvideomaker';
}

export function metaPath(dir: string): string {
  return join(dir, META_FILE);
}

export function storePath(dir: string): string {
  return join(dir, STORE_FILE);
}

export function mediaDirPath(dir: string, sub: MediaDir): string {
  return join(dir, sub);
}

export function createLayout(dir: string): string[] {
  const created: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (const sub of MEDIA_DIRS) {
    const p = mediaDirPath(dir, sub);
    mkdirSync(p, { recursive: true });
    created.push(p);
  }
  return created;
}
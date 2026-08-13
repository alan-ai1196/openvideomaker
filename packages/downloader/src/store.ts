import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, statfsSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DownloadError, type ModelManifest } from './types.js';

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function casPath(storeDir: string, sha256: string): string {
  return join(storeDir, 'files', sha256.slice(0, 2), sha256);
}

function manifestPath(storeDir: string, modelId: string, revision: string): string {
  return join(storeDir, 'manifests', modelId.replace(/[/\\:]/g, '_'), revision + '.json');
}

/**
 * Content-addressed model store: identical files obtained through any
 * source land in one CAS location, and manifests pin a model revision to
 * its verified file set. Never executes anything it stores.
 */
export class ModelStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, 'files'), { recursive: true });
    mkdirSync(join(dir, 'manifests'), { recursive: true });
  }

  /** Sanitize a relative model file path; reject traversal and absolute paths. */
  static safePath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      throw new DownloadError('store.invalid-path', 'absolute paths are not allowed: ' + path);
    }
    const parts = normalized.split('/').filter((p) => p.length > 0 && p !== '.');
    if (parts.some((p) => p === '..')) {
      throw new DownloadError('store.invalid-path', 'path traversal is not allowed: ' + path);
    }
    return parts.join('/');
  }

  installed(modelId: string, revision: string): boolean {
    const manifestFile = manifestPath(this.dir, modelId, revision);
    if (!existsSync(manifestFile)) return false;
    let manifest: ModelManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ModelManifest;
    } catch {
      return false;
    }
    return manifest.files.every((f) => existsSync(casPath(this.dir, f.sha256)));
  }

  manifest(modelId: string, revision: string): ModelManifest | null {
    const manifestFile = manifestPath(this.dir, modelId, revision);
    if (!existsSync(manifestFile)) return null;
    return JSON.parse(readFileSync(manifestFile, 'utf8')) as ModelManifest;
  }

  /** Resolve a stored model file to its content-addressed path. */
  filePath(modelId: string, revision: string, path: string): string {
    const manifest = this.manifest(modelId, revision);
    const file = manifest?.files.find((f) => f.path === ModelStore.safePath(path));
    if (!file) throw new DownloadError('store.invalid-path', 'file not installed: ' + path);
    return casPath(this.dir, file.sha256);
  }

  /** Adopt a downloaded file into the CAS (dedupes by content hash). */
  adopt(tempFile: string, expectedSha256: string | undefined, expectedSha1?: string): { sha256: string; sizeBytes: number } {
    const actual = sha256Of(tempFile);
    if (expectedSha256 && actual !== expectedSha256) {
      rmSync(tempFile, { force: true });
      throw new DownloadError('download.integrity', 'integrity check failed: expected sha256 ' + expectedSha256.slice(0, 12) + '..., got ' + actual.slice(0, 12) + '...');
    }
    if (expectedSha1 && !expectedSha256) {
      const actualSha1 = createHash('sha1').update(readFileSync(tempFile)).digest('hex');
      if (actualSha1 !== expectedSha1) {
        rmSync(tempFile, { force: true });
        throw new DownloadError('download.integrity', 'integrity check failed: expected sha1 ' + expectedSha1.slice(0, 12) + '..., got ' + actualSha1.slice(0, 12) + '...');
      }
    }
    const dest = casPath(this.dir, actual);
    const sizeBytes = statSync(tempFile).size;
    if (!existsSync(dest)) {
      mkdirSync(join(this.dir, 'files', actual.slice(0, 2)), { recursive: true });
      renameSync(tempFile, dest);
    } else {
      rmSync(tempFile, { force: true });
    }
    return { sha256: actual, sizeBytes };
  }

  /** Record a manifest pinning a model revision to its file set. */
  writeManifest(modelId: string, revision: string, files: Array<{ path: string; sha256: string; sizeBytes: number }>): void {
    const manifest: ModelManifest = { schemaVersion: 1, modelId, revision, installedAt: new Date().toISOString(), files };
    const file = manifestPath(this.dir, modelId, revision);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(manifest, null, 2));
  }

  /** Expire the partial temp files for a model (cancellation cleanup). */
  cleanPartials(modelId: string): void {
    const partialDir = join(this.dir, 'partial', modelId.replace(/[/\\:]/g, '_'));
    rmSync(partialDir, { recursive: true, force: true });
  }

  partialFile(modelId: string, path: string): string {
    const safe = ModelStore.safePath(path);
    const dir = join(this.dir, 'partial', modelId.replace(/[/\\:]/g, '_'));
    mkdirSync(dir, { recursive: true });
    return resolve(dir, safe);
  }

  diskFreeBytes(): number {
    try {
      const stats = statfsSync(this.dir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }
}

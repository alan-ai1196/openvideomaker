import type { ModelEntry, ModelFile } from '@openvideomaker/registry';
import { candidateUrls, orderSources } from './providers.js';
import { ModelStore } from './store.js';
import { downloadFile } from './download.js';
import { DownloadError, DownloadJob, type DownloadJobState, type SourceProfile } from './types.js';

export interface InstallOptions {
  profile?: SourceProfile;
  revision?: string;
  onProgress?: (job: DownloadJob) => void;
}

/**
 * Install a model's files into the content-addressed store.
 * Requires an explicit file manifest (entry.files) - entries without one
 * fail loudly rather than guessing, because integrity verification is the
 * whole point of the store.
 */
export async function installModel(store: ModelStore, entry: ModelEntry, options: InstallOptions = {}): Promise<DownloadJob> {
  const job = new DownloadJob('install:' + entry.id);
  const revision = options.revision ?? entry.sources.find((s) => s.kind === 'hf')?.revision ?? entry.sources.find((s) => s.kind === 'modelscope')?.revision ?? 'main';
  if (!entry.files || entry.files.length === 0) {
    job.state = 'failed';
    job.error = 'This model has no verified file manifest yet, so it cannot be installed safely.';
    job.emit('failed');
    return job;
  }
  if (store.installed(entry.id, revision)) {
    job.state = 'completed';
    job.emit('completed');
    return job;
  }

  const profile = options.profile ?? 'auto';
  const sources = orderSources(entry.sources, profile);
  const controller = new AbortController();
  job.attach(controller);
  job.state = 'downloading';
  job.stage = 'downloading';
  job.emit('downloading');
  const stateOf = (): DownloadJobState => job.state;

  const requiredBytes = entry.files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
  job.totalBytes = requiredBytes > 0 ? requiredBytes : null;
  const adopted: Array<{ path: string; sha256: string; sizeBytes: number }> = [];

  for (const file of entry.files) {
    if (stateOf() !== 'downloading') break;
    const safe = ModelStore.safePath(file.path);
    job.stage = 'downloading:' + safe;
    job.log('downloading ' + safe);
    let lastError: Error | null = null;
    let succeeded = false;
    for (const source of sources) {
      const urls = candidateUrls(source, safe, profile);
      for (const url of urls) {
        try {
          const dest = store.partialFile(entry.id, safe);
          await downloadFile({
            url,
            dest,
            signal: controller.signal,
            timeoutMs: 0,
            onProgress: (progress) => {
              job.bytes = progress.bytes;
              job.emit('progress');
            },
          });
          const { sha256, sizeBytes } = await store.adopt(dest, file.sha256, file.sha1);
          adopted.push({ path: safe, sha256, sizeBytes });
          succeeded = true;
          break;
        } catch (err) {
          lastError = err as Error;
          job.log('source failed: ' + url + ' - ' + (err as Error).message);
        }
      }
      if (succeeded) break;
    }
    if (!succeeded) {
      job.state = stateOf() === 'cancelled' ? 'cancelled' : 'failed';
      job.error = lastError ? lastError.message : 'all sources failed for ' + safe;
      job.attach(null);
      job.emit(job.state);
      return job;
    }
  }

  if (stateOf() === 'cancelled') {
    store.cleanPartials(entry.id);
    job.attach(null);
    job.emit('cancelled');
    return job;
  }
  store.writeManifest(entry.id, revision, adopted);
  job.state = 'completed';
  job.attach(null);
  job.emit('completed');
  return job;
}

export type { ModelFile };

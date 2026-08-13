import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadError, downloadFile, installModel, ModelStore } from '@openvideomaker/downloader';
import type { ModelEntry } from '@openvideomaker/registry';

const dir = mkdtempSync(join(tmpdir(), 'ovm-dl-'));
const fixtureDir = join(dir, 'fixture');
mkdirSync(fixtureDir);
const bigContent = Buffer.alloc(3 * 1024 * 1024, 7);
const smallContent = Buffer.from('openvideomaker test payload');
writeFileSync(join(fixtureDir, 'big.bin'), bigContent);
writeFileSync(join(fixtureDir, 'small.bin'), smallContent);
writeFileSync(join(fixtureDir, 'same-as-small.bin'), smallContent);

let server: Server;
let baseUrl = '';
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.method + ' ' + req.url + ' range=' + (req.headers.range ?? 'none'));
    const file = join(fixtureDir, decodeURIComponent((req.url ?? '/').replace(/^\//, '')));
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const stat = statSync(file);
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-/.exec(range);
      if (match) {
        const start = Number(match[1]);
        res.writeHead(206, { 'content-range': 'bytes ' + start + '-' + (stat.size - 1) + '/' + stat.size, 'content-length': String(stat.size - start), 'accept-ranges': 'bytes' });
        createReadStream(file, { start }).pipe(res);
        return;
      }
    }
    res.writeHead(200, { 'content-length': String(stat.size), 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address && typeof address === 'object') baseUrl = 'http://127.0.0.1:' + address.port;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function makeEntry(files: Array<{ path: string; sha256?: string; sizeBytes?: number }>, extraUrls: Record<string, string> = {}): ModelEntry {
  return {
    schemaVersion: 1,
    id: 'http/test/model',
    displayName: 'Test Model',
    category: 'speech',
    description: 'test',
    upstream: { project: 'test', url: 'https://example.com' },
    capabilities: ['audio.tts'],
    runner: { kind: 'local-python' },
    hardware: [{ platform: 'cpu', status: 'expected' }],
    memory: {},
    license: { id: 'apache-2.0', name: 'Apache-2.0' },
    sources: [{ kind: 'http', baseUrl: baseUrl, files: Object.fromEntries(files.map((f) => [f.path, baseUrl + '/' + f.path, ...Object.entries(extraUrls)])) }],
    files,
    limitations: [],
    verification: { trust: 'unverified', evidence: 'local test' },
    updatePolicy: { kind: 'manual' },
  };
}

describe('downloadFile', () => {
  it('downloads a file with progress', async () => {
    const dest = join(dir, 'plain.bin');
    const progress: number[] = [];
    await downloadFile({ url: baseUrl + '/small.bin', dest, onProgress: (p) => progress.push(p.bytes) });
    expect(readFileSync(dest)).toEqual(smallContent);
    expect(progress.at(-1)).toBe(smallContent.length);
  });

  it('resumes from a partial with a Range request', async () => {
    const dest = join(dir, 'resume.bin');
    const controller = new AbortController();
    let aborted = false;
    try {
      await downloadFile({
        url: baseUrl + '/big.bin',
        dest,
        signal: controller.signal,
        onProgress: (p) => {
          if (!aborted && p.bytes > 1_000_000) {
            aborted = true;
            // Defer: aborting synchronously inside the stream callback deadlocks fetch bodies.
            setTimeout(() => controller.abort(), 0);
          }
        },
      });
    } catch {
      /* expected abort */
    }
    expect(existsSync(dest + '.part')).toBe(true);
    const before = requests.length;
    await downloadFile({ url: baseUrl + '/big.bin', dest });
    expect(readFileSync(dest)).toEqual(bigContent);
    const resumed = requests.slice(before).join(' ');
    expect(resumed).toContain('range=bytes=');
    // Note: undici can take a few seconds to recycle the aborted connection.
  }, 15_000);

  it('fails loudly for HTTP errors', async () => {
    // undici can transiently fail a request right after an aborted
    // connection is recycled (see the resume test above), so retry a
    // few times but keep the strict 404 assertion.
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await downloadFile({ url: baseUrl + '/missing.bin', dest: join(dir, 'x.bin') });
        throw new Error('expected the download to fail');
      } catch (err) {
        lastError = err as Error;
        if (lastError.message.includes('HTTP 404')) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    expect(lastError?.message).toContain('HTTP 404');
  });
});

describe('ModelStore + installModel', () => {
  it('installs files, dedupes identical content, and verifies integrity', async () => {
    const store = new ModelStore(join(dir, 'store'));
    const entry = makeEntry([
      { path: 'small.bin', sha256: sha256(smallContent), sizeBytes: smallContent.length },
      { path: 'same-as-small.bin', sha256: sha256(smallContent), sizeBytes: smallContent.length },
    ]);
    const job = await installModel(store, entry, { profile: 'global' });
    expect(job.state).toBe('completed');
    expect(job.error).toBeNull();
    expect(store.installed(entry.id, 'main')).toBe(true);
    // identical content -> one CAS file
    const casFiles = readdirSync(join(store.dir, 'files', sha256(smallContent).slice(0, 2)));
    expect(casFiles).toHaveLength(1);
    expect(readFileSync(store.filePath(entry.id, 'main', 'small.bin'))).toEqual(smallContent);
  });

  it('rejects corrupted downloads via sha256', async () => {
    const store = new ModelStore(join(dir, 'store-bad'));
    const entry = makeEntry([{ path: 'small.bin', sha256: 'f'.repeat(64) }]);
    const job = await installModel(store, entry);
    expect(job.state).toBe('failed');
    expect(job.error).toContain('integrity check failed');
  });

  it('falls back across sources and reports when all fail', async () => {
    const store = new ModelStore(join(dir, 'store-fb'));
    const good = makeEntry([{ path: 'small.bin', sha256: sha256(smallContent) }]);
    const badUrl = 'http://127.0.0.1:1/nope.bin';
    const entryWithBadFirst: ModelEntry = {
      ...good,
      sources: [
        { kind: 'http', baseUrl: 'http://127.0.0.1:1', files: { 'small.bin': badUrl } },
        { kind: 'http', baseUrl: baseUrl, files: { 'small.bin': baseUrl + '/small.bin' } },
      ],
    };
    const job = await installModel(store, entryWithBadFirst);
    expect(job.state).toBe('completed');

    const store2 = new ModelStore(join(dir, 'store-allfail'));
    const allBad: ModelEntry = { ...good, sources: [{ kind: 'http', baseUrl: 'http://127.0.0.1:1', files: { 'small.bin': badUrl } }] };
    const failed = await installModel(store2, allBad);
    expect(failed.state).toBe('failed');
    expect(failed.logs.join(' ')).toContain('source failed');
  });

  it('requires a file manifest and rejects traversal paths', async () => {
    const store = new ModelStore(join(dir, 'store-nomanifest'));
    const noFiles = makeEntry([]);
    const job = await installModel(store, noFiles);
    expect(job.state).toBe('failed');
    expect(job.error).toContain('no verified file manifest');
    expect(() => ModelStore.safePath('../../etc/passwd')).toThrow(DownloadError);
    expect(() => ModelStore.safePath('C:/windows/system32/x')).toThrow(DownloadError);
    expect(ModelStore.safePath('sub/dir/model.safetensors')).toBe('sub/dir/model.safetensors');
  });
});

describe('large file adoption', () => {
  it('adopts a file larger than 2 GiB without buffering it', async () => {
    const store = new ModelStore(join(dir, 'store-large'));
    const target = 2 * 1024 * 1024 * 1024 + 1024 * 1024; // 2 GiB + 1 MiB
    const large = join(dir, 'large.bin');
    const chunk = Buffer.alloc(16 * 1024 * 1024, 0);
    const expected = createHash('sha256');
    const fd = openSync(large, 'w');
    let written = 0;
    while (written < target) {
      const n = Math.min(chunk.length, target - written);
      writeSync(fd, chunk, 0, n);
      expected.update(chunk.subarray(0, n));
      written += n;
    }
    closeSync(fd);
    const result = await store.adopt(large, undefined);
    expect(result.sizeBytes).toBe(target);
    expect(result.sha256).toBe(expected.digest('hex'));
    expect(existsSync(join(store.dir, 'files', result.sha256.slice(0, 2), result.sha256))).toBe(true);
    rmSync(large, { force: true });
  }, 120_000);
});


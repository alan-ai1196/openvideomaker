import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectSession } from '@openvideomaker/core';
import { ModelStore } from '@openvideomaker/downloader';
import { Registry } from '@openvideomaker/registry';
import type { ModelEntry } from '@openvideomaker/registry';
import { attachGeneratedMedia, attachTranscriptCaptions, GenerationRunner } from '@openvideomaker/jobs';

const dir = mkdtempSync(join(tmpdir(), 'ovm-jobs-'));
const modelBytes = Buffer.alloc(256 * 1024, 3);
const modelSha256 = createHash('sha256').update(modelBytes).digest('hex');

let server: Server;
let baseUrl = '';
let throttle = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if ((req.url ?? '/').includes('model.bin')) {
      res.writeHead(200, { 'content-length': String(modelBytes.length), 'accept-ranges': 'bytes' });
      let offset = 0;
      const tick = () => {
        const chunk = modelBytes.subarray(offset, offset + 64 * 1024);
        if (chunk.length === 0) {
          res.end();
          return;
        }
        offset += chunk.length;
        res.write(chunk);
        setTimeout(tick, throttle);
      };
      tick();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (address && typeof address === 'object') baseUrl = 'http://127.0.0.1:' + address.port;
});

afterAll(async () => {
  server.close();
  // Windows holds locks on freshly created venvs (AV scans, lingering
  // python handles); retry, then give up without failing the suite.
  await new Promise((r) => setTimeout(r, 500));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.warn('could not remove temp dir (file locks): ' + dir);
});

function makeEntry(): ModelEntry {
  return {
    schemaVersion: 1,
    id: 'http/test/model',
    displayName: 'Fake Test Model',
    category: 'speech',
    description: 'local fake model for jobs tests',
    upstream: { project: 'test', url: 'https://example.com' },
    capabilities: ['audio.tts'],
    runner: { kind: 'local-python' },
    hardware: [{ platform: 'cpu', status: 'expected' }],
    memory: {},
    license: { id: 'test', name: 'Test' },
    sources: [{ kind: 'http', baseUrl, files: { 'model.bin': baseUrl + '/model.bin' } }],
    files: [{ path: 'model.bin', sha256: modelSha256, sizeBytes: modelBytes.length }],
    limitations: [],
    verification: { trust: 'unverified', evidence: 'local fake' },
    updatePolicy: { kind: 'manual' },
  };
}

function makeRunner(): GenerationRunner {
  const registry = Registry.fromData([makeEntry()]);
  const store = new ModelStore(join(dir, 'store-' + Math.random().toString(36).slice(2, 8)));
  return new GenerationRunner({
    registry,
    store,
    runnersDir: resolve('test/fixtures'),
    runtimesDir: join(dir, 'runtimes'),
  });
}

describe('GenerationRunner', () => {
  it('runs a generation end to end and lands an asset with provenance', async () => {
    const runner = makeRunner();
    const job = runner.run({
      capability: 'audio.tts',
      modelId: 'http/test/model',
      settings: { seconds: 1, echo: 'hello' },
      outputDir: join(dir, 'out-ok'),
    });
    await job.finished;
    expect(job.state).toBe('completed');
    expect(job.error).toBeNull();
    expect(job.outputs.audio).toBeDefined();
    expect(job.metadata.durationUs).toBe(1_000_000);
    expect(job.provenance?.model.id).toBe('http/test/model');
    expect(job.provenance?.capability).toBe('audio.tts');
    expect(existsSync(job.outputs.audio!.path)).toBe(true);

    const session = ProjectSession.create('Jobs Test');
    const assetId = await attachGeneratedMedia(session, job, 'audio');
    const asset = session.project.assets[assetId];
    expect(asset?.origin.kind).toBe('generated');
    expect(asset?.media?.hasAudio).toBe(true);
    expect(asset?.media?.durationUs).toBe(1_000_000);
    const provenance = asset?.origin.kind === 'generated' ? asset.origin.provenance : null;
    expect(provenance?.capability).toBe('audio.tts');
    expect(provenance?.model.id).toBe('http/test/model');
    expect(provenance?.regenerable).toBe(true);
  }, 180_000);

  it('fails cleanly for unknown models', async () => {
    const runner = makeRunner();
    const job = runner.run({ capability: 'audio.tts', modelId: 'http/missing/model', outputDir: join(dir, 'out-x') });
    await job.finished;
    expect(job.state).toBe('failed');
    expect(job.error).toContain('jobs.model-unknown');
  });

  it('fails cleanly for capability mismatches', async () => {
    const runner = makeRunner();
    const job = runner.run({ capability: 'avatar.lip_sync', modelId: 'http/test/model', outputDir: join(dir, 'out-x2') });
    await job.finished;
    expect(job.state).toBe('failed');
    expect(job.error).toContain('jobs.capability-mismatch');
  });

  it('reports runner failures on the job', async () => {
    const runner = makeRunner();
    const job = runner.run({
      capability: 'audio.tts',
      modelId: 'http/test/model',
      settings: { fail: true },
      outputDir: join(dir, 'out-fail'),
    });
    await job.finished;
    expect(job.state).toBe('failed');
    expect(job.error).toContain('requested failure');
  }, 180_000);

  it('cancels a slow install', async () => {
    throttle = 60;
    try {
      const runner = makeRunner();
      const job = runner.run({ capability: 'audio.tts', modelId: 'http/test/model', outputDir: join(dir, 'out-cancel') });
      job.subscribe((event) => {
        if (event.state === 'installing' && event.bytes > 0) job.cancel();
      });
      await job.finished;
      expect(job.state).toBe('cancelled');
    } finally {
      throttle = 0;
    }
  }, 60_000);

  it('attaches an ASR transcript and syncs caption clips from it', async () => {
    const runner = makeRunner();
    const job = runner.run({ capability: 'audio.tts', modelId: 'http/test/model', settings: { seconds: 1 }, outputDir: join(dir, 'out-transcript') });
    await job.finished;
    expect(job.state).toBe('completed');
    const session = ProjectSession.create('ASR Attach');
    const assetId = await attachGeneratedMedia(session, job, 'audio');
    const result = attachTranscriptCaptions(session, job, { audioAssetId: assetId });
    expect(result.segmentCount).toBe(2);
    const transcript = session.project.transcripts[result.transcriptId];
    expect(transcript?.source.kind).toBe('asr');
    expect(transcript?.segments).toHaveLength(2);
    expect(session.project.assetTranscripts[assetId]).toBe(result.transcriptId);
    const sequenceId = Object.keys(session.project.sequences)[0]!;
    const track = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'caption');
    expect(track?.clips).toHaveLength(2);
    expect(track?.clips[0]?.provenance?.capability).toBe('audio.tts');
    // Re-attaching replaces instead of duplicating.
    const again = attachTranscriptCaptions(session, job, { audioAssetId: assetId });
    expect(again.segmentCount).toBe(2);
    expect(session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'caption')?.clips).toHaveLength(2);
  }, 180_000);

  it('cancels a running generation', async () => {
    const runner = makeRunner();
    const job = runner.run({
      capability: 'audio.tts',
      modelId: 'http/test/model',
      settings: { sleepSteps: 12 },
      outputDir: join(dir, 'out-running'),
    });
    job.subscribe((event) => {
      if (event.state === 'running') job.cancel();
    });
    await job.finished;
    expect(job.state).toBe('cancelled');
    expect(job.outputs.audio).toBeUndefined();
  }, 60_000);
});

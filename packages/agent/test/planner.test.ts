import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectSession } from '@openvideomaker/core';
import { mediaClip, importedAsset } from '@openvideomaker/core';
import { describeProjectForPlanner, LlmPlanner, createProposal, applyProposal, resolveLlmConfigFromEnv, ORCAROUTER_DEFAULT_BASE_URL } from '@openvideomaker/agent';
import type { EditScript } from '@openvideomaker/schema';

// A real local HTTP endpoint standing in for an OpenAI-compatible
// provider, so the planner's wire path is exercised honestly. Scripted
// responses prove validation, the repair round, and compilation.
let server: Server;
let baseUrl = '';
let responseMode: 'valid' | 'repair' | 'always-invalid' = 'valid';
let requestCount = 0;
let lastBody: { model?: unknown; messages?: Array<{ role: string; content: string }> } = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      requestCount += 1;
      lastBody = JSON.parse(raw) as typeof lastBody;
      // A REAL step needs a real id: pull the sequence id out of the
      // project description the planner sent.
      const userText = (lastBody.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join(' ');
      const match = /"(seq_[a-z0-9]+)"/.exec(userText);
      const sequenceId = match ? match[1] : 'seq_missing';
      let content: unknown;
      if (responseMode === 'always-invalid') {
        content = { not: 'a script' };
      } else if (responseMode === 'repair' && requestCount === 1) {
        content = { schemaVersion: 1, goal: 'broken', steps: 'oops' };
      } else {
        content = {
          schemaVersion: 1,
          goal: 'add caption track',
          steps: [{ op: 'track.create', sequenceId, kind: 'caption', name: 'Captions', as: '$captions' }],
        };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (address && typeof address === 'object') baseUrl = 'http://127.0.0.1:' + address.port + '/v1/chat/completions';
});

afterAll(() => {
  server.close();
});

function setupProject(): ProjectSession {
  const session = ProjectSession.create('Planner Test');
  const sequenceId = Object.keys(session.project.sequences)[0];
  const asset = importedAsset({ kind: 'video', name: 'a.mp4', path: 'C:/a.mp4', media: { durationUs: 10_000_000, hasVideo: true, hasAudio: false } });
  session.transaction((tx) => {
    tx.importAsset({ asset });
    const trackId = tx.newTrackId();
    tx.createTrack({ sequenceId, trackId, kind: 'video' });
    tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 4_000_000 }) });
  });
  return session;
}

describe('LlmPlanner', () => {
  it('describes a project with every referenceable id', () => {
    const session = setupProject();
    const summary = describeProjectForPlanner(session.project as never);
    const sequenceId = Object.keys(session.project.sequences)[0];
    expect(summary).toContain(sequenceId);
    for (const track of session.project.sequences[sequenceId]!.tracks) {
      expect(summary).toContain(track.id);
      for (const clip of track.clips) expect(summary).toContain(clip.id);
    }
  });

  it('plans through a real HTTP endpoint, compiles, and applies as one undoable transaction', async () => {
    responseMode = 'valid';
    const session = setupProject();
    const planner = new LlmPlanner({ endpoint: baseUrl, model: 'mock-model' });
    const result = await planner.plan(session, 'Shorten the first clip');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.schemaVersion).toBe(1);
    expect(result.plan.goal).toContain('Shorten');
    expect(lastBody.model).toBe('mock-model');
    const proposal = createProposal(session.project as never, result.plan, result.script);
    expect(proposal.preview.ok).toBe(true);
    const applied = applyProposal(session, proposal);
    expect(applied.ok).toBe(true);
    expect(proposal.state).toBe('applied');
    expect(session.canUndo).toBe(true);
    const sequenceId = Object.keys(session.project.sequences)[0];
    expect(session.project.sequences[sequenceId]!.tracks.some((t) => t.kind === 'caption')).toBe(true);
  });

  it('repairs an invalid first response using the validation error', async () => {
    responseMode = 'repair';
    requestCount = 0;
    const session = setupProject();
    const planner = new LlmPlanner({ endpoint: baseUrl, model: 'mock-model' });
    const result = await planner.plan(session, 'Repair me');
    expect(requestCount).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.script.steps).toHaveLength(1);
  });

  it('fails cleanly when the model never produces a valid script', async () => {
    responseMode = 'always-invalid';
    requestCount = 0;
    const session = setupProject();
    const planner = new LlmPlanner({ endpoint: baseUrl, model: 'mock-model' });
    const result = await planner.plan(session, 'Never valid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('llm.invalid-script');
  });
});

describe('resolveLlmConfigFromEnv', () => {
  it('resolves the OrcaRouter preset with the official default endpoint', () => {
    const config = resolveLlmConfigFromEnv({ ORCAROUTER_API_KEY: 'orkey', ORCAROUTER_MODEL: 'openai/gpt-4o-mini' });
    expect(config).toEqual({ provider: 'orcarouter', endpoint: ORCAROUTER_DEFAULT_BASE_URL, model: 'openai/gpt-4o-mini', apiKey: 'orkey' });
  });

  it('honors an explicit ORCAROUTER_BASE_URL', () => {
    const config = resolveLlmConfigFromEnv({ ORCAROUTER_API_KEY: 'orkey', ORCAROUTER_MODEL: 'm', ORCAROUTER_BASE_URL: 'https://example.test/v1' });
    expect(config?.endpoint).toBe('https://example.test/v1');
  });

  it('prefers the generic preset when both are configured (OrcaRouter never overrides)', () => {
    const config = resolveLlmConfigFromEnv({
      OVM_LLM_ENDPOINT: 'https://mine.test/v1/chat/completions',
      OVM_LLM_MODEL: 'local-model',
      ORCAROUTER_API_KEY: 'orkey',
      ORCAROUTER_MODEL: 'openai/gpt-4o-mini',
    });
    expect(config).toEqual({ provider: 'custom', endpoint: 'https://mine.test/v1/chat/completions', model: 'local-model', apiKey: undefined });
  });

  it('returns null without configuration (the deterministic planner stays the default)', () => {
    expect(resolveLlmConfigFromEnv({})).toBeNull();
    expect(resolveLlmConfigFromEnv({ ORCAROUTER_API_KEY: 'orkey' })).toBeNull();
    expect(resolveLlmConfigFromEnv({ ORCAROUTER_MODEL: 'm' })).toBeNull();
  });
});
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Registry } from '@openvideomaker/registry';
import { McpServer } from '@openvideomaker/mcp';

const registry = Registry.fromData(JSON.parse(readFileSync(resolve('../../packages/registry/src/data/index.json'), 'utf8')));

function makeServer(): McpServer {
  return new McpServer({ registry });
}

async function call(server: McpServer, method: string, params: Record<string, unknown> = {}, id: number | string = 1): Promise<{ id: unknown; result?: any; error?: any }> {
  const line = await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  if (line === null) throw new Error('expected a response for ' + method);
  return JSON.parse(line) as { id: unknown; result?: any; error?: any };
}

describe('MCP protocol lifecycle', () => {
  it('negotiates initialize and ignores notifications', async () => {
    const server = makeServer();
    const init = await call(server, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.serverInfo.name).toBe('openvideomaker');
    expect(init.result.capabilities.tools.listChanged).toBe(false);
    const notification = await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(notification).toBeNull();
    const ping = await call(server, 'ping');
    expect(ping.result).toEqual({});
  });

  it('lists the semantic tool set', async () => {
    const server = makeServer();
    const list = await call(server, 'tools/list');
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('project.create');
    expect(names).toContain('project.inspect');
    expect(names).toContain('timeline.inspect');
    expect(names).toContain('edit.preview');
    expect(names).toContain('edit.apply');
    expect(names).toContain('character.create');
    expect(names).toContain('model.search');
    expect(names).not.toContain('run_latentsync');
  });

  it('reports unknown methods and tools with JSON-RPC errors', async () => {
    const server = makeServer();
    const unknown = await call(server, 'bogus/method');
    expect(unknown.error.code).toBe(-32601);
    const tool = await call(server, 'tools/call', { name: 'bogus.tool' });
    expect(tool.error.code).toBe(-32602);
  });
});

describe('MCP editing flow', () => {
  it('creates a project, applies an EditScript and inspects the result', async () => {
    const server = makeServer();
    const created = await call(server, 'tools/call', { name: 'project.create', arguments: { name: 'Agent Project', width: 1280, height: 720 } });
    expect(created.result.content[0].text).toContain('created project');

    const inspect = await call(server, 'tools/call', { name: 'project.inspect', arguments: {} });
    const summary = JSON.parse(inspect.result.content[0].text);
    expect(summary.name).toBe('Agent Project');
    expect(summary.counts.sequences).toBe(1);

    const sequenceId = summary.id ? undefined : undefined;
    void sequenceId;
    // The new project has one empty sequence; create a video track and a text clip through an EditScript.
    const applied = await call(server, 'tools/call', {
      name: 'edit.apply',
      arguments: {
        script: {
          schemaVersion: 1,
          goal: 'add a title',
          steps: [{ op: 'track.create', sequenceId: 'seq_missing', kind: 'text', name: 'Text 1' }],
        },
      },
    });
    const applyResult = JSON.parse(applied.result.content[0].text);
    // A missing sequence id fails loudly - the agent must inspect first.
    expect(applyResult.ok).toBe(false);
    expect(applyResult.errors.join(' ')).toContain('unknown sequence');
  });

  it('previews and applies edits against a real sequence id', async () => {
    const server = makeServer();
    await call(server, 'tools/call', { name: 'project.create', arguments: { name: 'P2' } });
    const timeline = await call(server, 'tools/call', { name: 'timeline.inspect', arguments: {} });
    const timelineData = JSON.parse(timeline.result.content[0].text);
    const sequenceId = timelineData.sequences[0].id;
    const script = {
      schemaVersion: 1,
      steps: [
        { op: 'track.create', sequenceId, kind: 'text', name: 'Text 1', as: '$text' },
        { op: 'text.insert', trackId: '$text', start: 0, duration: 2000000, content: 'Hello from MCP' },
      ],
    };
    const preview = await call(server, 'tools/call', { name: 'edit.preview', arguments: { script } });
    const previewData = JSON.parse(preview.result.content[0].text);
    expect(previewData.ok).toBe(true);
    expect(previewData.appliedTypes).toEqual(['track.create', 'clip.insert']);
    const applied = await call(server, 'tools/call', { name: 'edit.apply', arguments: { script } });
    const applyData = JSON.parse(applied.result.content[0].text);
    expect(applyData.ok).toBe(true);
    const after = await call(server, 'tools/call', { name: 'timeline.inspect', arguments: {} });
    const afterData = JSON.parse(after.result.content[0].text);
    expect(afterData.sequences[0].tracks[0].clips[0].text).toBe('Hello from MCP');
  });

  it('creates characters and searches models by capability', async () => {
    const server = makeServer();
    await call(server, 'tools/call', { name: 'project.create', arguments: { name: 'P3' } });
    const created = await call(server, 'tools/call', {
      name: 'character.create',
      arguments: { name: 'Alice', provider: 'hf/hexgrad/Kokoro-82M', voiceId: 'af_heart', consent: true },
    });
    expect(created.result.content[0].text).toContain('created character');
    const characters = await call(server, 'tools/call', { name: 'character.inspect', arguments: {} });
    expect(characters.result.content[0].text).toContain('Alice');
    const search = await call(server, 'tools/call', { name: 'model.search', arguments: { capability: 'audio.asr' } });
    const results = JSON.parse(search.result.content[0].text);
    expect(results.map((r: { id: string }) => r.id)).toContain('hf/openai/whisper-large-v3');
  });

  it('serves project and model resources', async () => {
    const server = makeServer();
    const list = await call(server, 'resources/list');
    expect(list.result.resources.some((r: { uri: string }) => r.uri === 'project://current')).toBe(true);
    const model = await call(server, 'resources/read', { uri: 'model://hf/hexgrad/Kokoro-82M' });
    expect(model.result.contents[0].text).toContain('Kokoro-82M');
    await call(server, 'tools/call', { name: 'project.create', arguments: { name: 'P4' } });
    const project = await call(server, 'resources/read', { uri: 'project://current' });
    expect(JSON.parse(project.result.contents[0].text).project.name).toBe('P4');
  });
});

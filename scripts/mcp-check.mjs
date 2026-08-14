import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProjectSession, mediaClip, importedAsset } from '@openvideomaker/core';
import { ProjectStore } from '@openvideomaker/persistence';

/**
 * End-to-end MCP session over stdio against the real ovm-mcp binary:
 * initialize -> tools/list -> project.create -> edit.apply ->
 * project.inspect -> resources/read. Then a SECOND server attaches to
 * a real saved project with --project and reads the same truth.
 */
// A real project folder on disk for the --project scenario.
const savedDir = join(tmpdir(), 'ovm-mcp-check-' + Date.now());
mkdirSync(savedDir);
const savedSession = ProjectSession.create('Saved For MCP');
const savedSeq = Object.keys(savedSession.project.sequences)[0];
const savedAsset = importedAsset({ kind: 'audio', name: 'voice.wav', path: 'C:/voice.wav', media: { durationUs: 2_000_000, hasVideo: false, hasAudio: true } });
savedSession.transaction((tx) => {
  tx.importAsset({ asset: savedAsset });
  const trackId = tx.newTrackId();
  tx.createTrack({ sequenceId: savedSeq, trackId, kind: 'audio' });
  tx.insertClip({ sequenceId: savedSeq, trackId, clip: mediaClip({ trackId, assetId: savedAsset.id, start: 0, duration: 2_000_000 }) });
});
const savedStore = ProjectStore.create(savedDir, savedSession.projectId);
savedStore.save(savedSession.project, savedSession.exportLog());
savedStore.close();
const child = spawn(process.execPath, ['packages/mcp/dist/cli.js'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let seq = 0;
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id !== null && pending.has(message.id)) {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve(message);
  }
});
child.stderr.on('data', (chunk) => process.stderr.write('[stderr] ' + chunk));

function request(method, params = {}) {
  return new Promise((resolveRequest, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout waiting for ' + method));
    }, 30_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolveRequest(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const report = {};
report.initialize = await request('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'ovm-check' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
report.tools = await request('tools/list');
report.toolNames = report.tools.result.tools.map((t) => t.name);
report.create = await request('tools/call', { name: 'project.create', arguments: { name: 'MCP E2E Project' } });
report.timeline = await request('tools/call', { name: 'timeline.inspect', arguments: {} });
const sequenceId = JSON.parse(report.timeline.result.content[0].text).sequences[0].id;
report.edit = await request('tools/call', {
  name: 'edit.apply',
  arguments: {
    script: {
      schemaVersion: 1,
      goal: 'add a title via MCP',
      steps: [
        { op: 'track.create', sequenceId, kind: 'text', name: 'Text 1', as: '$text' },
        { op: 'text.insert', trackId: '$text', start: 0, duration: 2_000_000, content: 'Hello via MCP' },
      ],
    },
  },
});
report.after = await request('tools/call', { name: 'project.inspect', arguments: {} });
report.resource = await request('resources/read', { uri: 'project://current' });
report.modelResource = await request('resources/read', { uri: 'model://hf/hexgrad/Kokoro-82M' });
console.log(JSON.stringify({
  protocolVersion: report.initialize.result.protocolVersion,
  toolCount: report.toolNames.length,
  hasEditTools: report.toolNames.includes('edit.apply') && report.toolNames.includes('edit.preview'),
  createText: report.create.result.content[0].text,
  editOk: JSON.parse(report.edit.result.content[0].text).ok,
  inspectName: JSON.parse(report.after.result.content[0].text).name,
  resourceName: JSON.parse(report.resource.result.contents[0].text).project.name,
  modelResourceHasKokoro: report.modelResource.result.contents[0].text.includes('Kokoro-82M'),
}, null, 2));

const afterData = JSON.parse(report.after.result.content[0].text);
if (report.initialize.result.protocolVersion !== '2025-06-18') throw new Error('bad protocol version');
if (!report.toolNames.includes('edit.apply')) throw new Error('edit.apply tool missing');
if (!JSON.parse(report.edit.result.content[0].text).ok) throw new Error('edit.apply failed');
if (afterData.name !== 'MCP E2E Project') throw new Error('project.inspect mismatch');
if (JSON.parse(report.resource.result.contents[0].text).project.name !== 'MCP E2E Project') throw new Error('resource mismatch');
console.log('MCP CHECK OK');
child.stdin.end();

// Second server: --project binds an EXISTING saved project, so agents
// see the same truth the Studio saved.
const child2 = spawn(process.execPath, ['packages/mcp/dist/cli.js', '--project', resolve(savedDir)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines2 = createInterface({ input: child2.stdout });
const pending2 = new Map();
let seq2 = 0;
lines2.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id !== null && pending2.has(message.id)) {
    pending2.get(message.id)(message);
    pending2.delete(message.id);
  }
});
const request2 = (method, params = {}) => new Promise((resolveRequest, reject) => {
  const id = ++seq2;
  const timer = setTimeout(() => reject(new Error('timeout: ' + method)), 30_000);
  pending2.set(id, (message) => { clearTimeout(timer); resolveRequest(message); });
  child2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + String.fromCharCode(10));
});
await request2('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'ovm-check-project' } });
child2.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + String.fromCharCode(10));
const savedInspect = await request2('tools/call', { name: 'project.inspect', arguments: {} });
const savedResource = await request2('resources/read', { uri: 'project://current' });
const savedName = JSON.parse(savedInspect.result.content[0].text).name;
const resourceName = JSON.parse(savedResource.result.contents[0].text).project.name;
if (savedName !== 'Saved For MCP') throw new Error('--project inspect mismatch: ' + savedName);
if (resourceName !== 'Saved For MCP') throw new Error('--project resource mismatch: ' + resourceName);
if (!savedResource.result.contents[0].text.includes('voice.wav')) throw new Error('--project lost the saved media');
child2.stdin.end();
rmSync(savedDir, { recursive: true, force: true });
console.log('MCP PROJECT CHECK OK');

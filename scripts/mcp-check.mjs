import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * End-to-end MCP session over stdio against the real ovm-mcp binary:
 * initialize -> tools/list -> project.create -> edit.apply ->
 * project.inspect -> resources/read. Re-runnable.
 */
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

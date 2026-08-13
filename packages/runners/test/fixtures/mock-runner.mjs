// Mock runner implementing the OpenVideoMaker NDJSON runner protocol.
// Used by RunnerHost tests; crashes after describe with --crash.
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const crash = process.argv.includes('--crash');
const slowMs = Number(process.argv.find((a) => a.startsWith('--slow='))?.split('=')[1] ?? 0);

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

let currentTimer = null;
let currentRequestId = null;

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'describe') {
    send({ id: request.id, ok: true, protocolVersion: 1, capabilities: ['audio.tts'], models: ['mock/tts'], runner: { name: 'mock-runner', version: '1.0.0' } });
    if (crash) process.exit(7);
    return;
  }
  if (request.method === 'prepare') {
    send({ id: request.id, ok: true, estimate: { seconds: 1, note: 'mock estimate' } });
    return;
  }
  if (request.method === 'execute') {
    const outputDir = request.params.outputDir;
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'speech.wav');
    currentRequestId = request.id;
    let tick = 0;
    currentTimer = setInterval(() => {
      tick += 0.2;
      send({ kind: 'progress', stage: 'generating', progress: Math.min(1, tick) });
      if (tick >= 1) {
        clearInterval(currentTimer);
        writeFileSync(outputPath, 'RIFFmock');
        send({ id: request.id, ok: true, outputs: { audio: { path: outputPath } }, metadata: { durationUs: 1_000_000 } });
      }
    }, Math.max(10, slowMs / 5));
    return;
  }
  if (request.method === 'health') {
    send({ id: request.id, ok: true });
    return;
  }
  if (request.method === 'cancel') {
    if (currentTimer) {
      clearInterval(currentTimer);
      currentTimer = null;
    }
    send({ kind: 'cancelled' });
    if (currentRequestId) {
      send({ id: currentRequestId, ok: false, error: { code: 'cancelled', message: 'work cancelled by host' } });
      currentRequestId = null;
    }
    return;
  }
  if (request.method === 'dispose') {
    send({ id: request.id, ok: true });
    process.exit(0);
  }
});

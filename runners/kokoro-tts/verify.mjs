#!/usr/bin/env node
/**
 * Real verification of the Kokoro TTS runner, end to end:
 * artifact store download -> isolated uv runtime -> runner protocol ->
 * generated WAV -> ffprobe. Re-runnable; artifacts land under .research/.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runTool } from '@openvideomaker/media';
import { readFileSync } from 'node:fs';
import { Registry } from '@openvideomaker/registry';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, UvRuntime } from '@openvideomaker/runners';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const entry = registry.byId('hf/hexgrad/Kokoro-82M');
if (!entry) throw new Error('kokoro entry missing');

mkdirSync(join(root, '.research/kokoro-out'), { recursive: true });
const store = new ModelStore(join(root, '.research/model-store'));

console.log('[1/4] downloading model artifacts through the store');
const job = await installModel(store, entry, {
  profile: 'auto',
  onProgress: (j) => {
    if (j.totalBytes && j.bytes % (Math.ceil(j.totalBytes / 20)) < 200000) {
      process.stdout.write('.');
    }
  },
});
if (job.state !== 'completed') {
  console.error('download failed: ' + job.error);
  process.exit(1);
}
console.log('\n[1/4] installed: ' + entry.id);

console.log('[2/4] ensuring isolated uv runtime');
const runtime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const env = await runtime.ensure('kokoro', join(root, 'runners/kokoro-tts'), '3.12');
console.log('[2/4] runtime: ' + env.pythonPath);

console.log('[3/4] running TTS through the runner protocol');
const host = new RunnerHost({
  command: env.pythonPath,
  args: [join(root, 'runners/kokoro-tts/runner.py')],
  envAllow: [],
});
host.subscribe((event) => {
  if (event.kind === 'log') console.log('  [runner] ' + event.message);
});
host.start();
const description = await host.describe(60_000);
if (!description.ok) throw new Error('describe failed');
const prepare = await host.prepare({
  capability: 'audio.tts',
  modelId: entry.id,
  modelFiles: {
    config: { path: store.filePath(entry.id, 'main', 'config.json') },
    model: { path: store.filePath(entry.id, 'main', 'kokoro-v1_0.pth') },
  },
  device: 'cpu',
}, 600_000);
if (!prepare.ok) throw new Error('prepare failed');
const outputDir = join(root, '.research/kokoro-out');
const execute = await host.execute({
  capability: 'audio.tts',
  modelId: entry.id,
  inputs: { voice: { path: store.filePath(entry.id, 'main', 'voices/af_heart.pt') } },
  settings: { text: 'OpenVideoMaker keeps everything editable.' },
  outputDir,
}, 900_000);
host.dispose();
if (!execute.ok) throw new Error('execute failed');
const wavPath = execute.outputs.audio.path;
console.log('[3/4] generated: ' + wavPath + ' (' + execute.metadata.durationUs / 1_000_000 + 's)');

console.log('[4/4] probing the output');
const probe = await runTool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'json', wavPath]);
if (probe.code !== 0) {
  console.error('probe failed: ' + probe.stderr);
  process.exit(1);
}
const info = JSON.parse(probe.stdout);
console.log('[4/4] probe: ' + JSON.stringify(info.streams) + ' duration=' + info.format.duration);
console.log('VERIFY OK');

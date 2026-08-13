#!/usr/bin/env node
/**
 * Real verification of the Whisper ASR runner, end to end:
 * Kokoro TTS synthesizes known speech -> artifact store download of the
 * CTranslate2 weights -> isolated uv runtime -> runner protocol ->
 * timed transcript + SRT. Re-runnable; artifacts land under .research/.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '@openvideomaker/registry';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, UvRuntime } from '@openvideomaker/runners';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const ttsEntry = registry.byId('hf/hexgrad/Kokoro-82M');
const asrEntry = registry.byId('hf/openai/whisper-large-v3');
if (!ttsEntry) throw new Error('kokoro entry missing');
if (!asrEntry) throw new Error('whisper entry missing');

const SENTENCE = 'Make videos with AI and keep everything editable.';
const outDir = join(root, '.research/whisper-out');
mkdirSync(outDir, { recursive: true });
const store = new ModelStore(join(root, '.research/model-store'));

console.log('[1/5] synthesizing known speech with the verified Kokoro runner');
const ttsRuntime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const ttsEnv = await ttsRuntime.ensure('kokoro', join(root, 'runners/kokoro-tts'), '3.12');
const ttsHost = new RunnerHost({
  command: ttsEnv.pythonPath,
  args: [join(root, 'runners/kokoro-tts/runner.py')],
  envAllow: [],
});
ttsHost.start();
const ttsDescribe = await ttsHost.describe(60_000);
if (!ttsDescribe.ok) throw new Error('kokoro describe failed');
const ttsPrepare = await ttsHost.prepare({
  capability: 'audio.tts',
  modelId: ttsEntry.id,
  modelFiles: {
    config: { path: store.filePath(ttsEntry.id, 'main', 'config.json') },
    model: { path: store.filePath(ttsEntry.id, 'main', 'kokoro-v1_0.pth') },
  },
  device: 'cpu',
}, 600_000);
if (!ttsPrepare.ok) throw new Error('kokoro prepare failed');
const ttsOutDir = join(outDir, 'tts');
mkdirSync(ttsOutDir, { recursive: true });
const ttsExecute = await ttsHost.execute({
  capability: 'audio.tts',
  modelId: ttsEntry.id,
  inputs: { voice: { path: store.filePath(ttsEntry.id, 'main', 'voices/af_heart.pt') } },
  settings: { text: SENTENCE },
  outputDir: ttsOutDir,
}, 900_000);
ttsHost.dispose();
if (!ttsExecute.ok) throw new Error('kokoro execute failed');
const inputWav = ttsExecute.outputs.audio.path;
console.log('[1/5] input: ' + inputWav + ' (' + ttsExecute.metadata.durationUs / 1_000_000 + 's)');

console.log('[2/5] downloading whisper weights through the store');
const job = await installModel(store, asrEntry, {
  profile: 'auto',
  onProgress: (j) => {
    if (j.totalBytes && j.bytes % (Math.ceil(j.totalBytes / 20)) < 400_000) process.stdout.write('.');
  },
});
if (job.state !== 'completed') {
  console.error('download failed: ' + job.error);
  process.exit(1);
}
console.log('\n[2/5] installed: ' + asrEntry.id);

console.log('[3/5] ensuring isolated uv runtime');
const runtime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const env = await runtime.ensure('whisper-asr', join(root, 'runners/whisper-asr'), '3.12');
console.log('[3/5] runtime: ' + env.pythonPath);

console.log('[4/5] transcribing through the runner protocol');
const host = new RunnerHost({
  command: env.pythonPath,
  args: [join(root, 'runners/whisper-asr/runner.py')],
  envAllow: [],
});
host.subscribe((event) => {
  if (event.kind === 'log') console.log('  [runner] ' + event.message);
});
host.start();
const description = await host.describe(60_000);
if (!description.ok) throw new Error('describe failed');
const prepare = await host.prepare({
  capability: 'audio.asr',
  modelId: asrEntry.id,
  modelFiles: {
    model: { path: store.filePath(asrEntry.id, 'main', 'model.bin') },
    config: { path: store.filePath(asrEntry.id, 'main', 'config.json') },
    tokenizer: { path: store.filePath(asrEntry.id, 'main', 'tokenizer.json') },
    preprocessor: { path: store.filePath(asrEntry.id, 'main', 'preprocessor_config.json') },
    vocabulary: { path: store.filePath(asrEntry.id, 'main', 'vocabulary.json') },
  },
  device: 'cuda',
}, 900_000);
if (!prepare.ok) throw new Error('prepare failed');
const execute = await host.execute({
  capability: 'audio.asr',
  modelId: asrEntry.id,
  inputs: { audio: { path: inputWav } },
  settings: { language: 'en' },
  outputDir: outDir,
}, 900_000);
host.dispose();
if (!execute.ok) throw new Error('execute failed');
const transcriptPath = execute.outputs.transcript.path;
const srtPath = execute.outputs.srt.path;
console.log('[4/5] transcript: ' + transcriptPath + ' (device ' + execute.metadata.device + ')');

console.log('[5/5] validating the transcript');
const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const srt = readFileSync(srtPath, 'utf8');
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
const expected = normalize(SENTENCE);
const actual = normalize(transcript.text);
const hit = expected.filter((word) => actual.includes(word)).length;
const ratio = hit / expected.length;
console.log('[5/5] expected: ' + JSON.stringify(expected));
console.log('[5/5] transcript: ' + JSON.stringify(transcript.text));
console.log('[5/5] word overlap: ' + hit + '/' + expected.length + ' (' + ratio.toFixed(2) + ')');
console.log('[5/5] segments: ' + transcript.segments.length + ', language: ' + transcript.language);
console.log('[5/5] srt head:\n' + srt.split('\n').slice(0, 8).join('\n'));
if (transcript.segments.length === 0) throw new Error('no segments produced');
if (ratio < 0.8) throw new Error('word overlap too low: ' + ratio.toFixed(2));
if (!srt.includes(' --> ')) throw new Error('srt missing timings');
console.log('VERIFY OK');

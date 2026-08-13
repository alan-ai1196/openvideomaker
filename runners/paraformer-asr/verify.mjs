#!/usr/bin/env node
/**
 * Real verification of the Paraformer ASR runner, end to end:
 * Windows SAPI (Huihui zh-CN voice) synthesizes known Mandarin speech ->
 * artifact store download of the ModelScope weights -> isolated uv
 * runtime -> runner protocol -> transcript + SRT. Re-runnable;
 * artifacts land under .research/paraformer-out/.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runTool } from '@openvideomaker/media';
import { Registry } from '@openvideomaker/registry';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, UvRuntime } from '@openvideomaker/runners';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const entry = registry.byId('ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch');
if (!entry) throw new Error('paraformer entry missing');

const SENTENCE = '今天天气很好，我们一起做视频吧。'; // 今天天气很好，我们一起做视频吧。
const outDir = join(root, '.research/paraformer-out');
mkdirSync(outDir, { recursive: true });
const store = new ModelStore(join(root, '.research/model-store'));

console.log('[1/4] synthesizing Mandarin speech with the Windows Huihui voice');
const wavPath = join(outDir, 'input.wav');
const script = "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "$s.SelectVoice('Microsoft Huihui Desktop'); " +
  "$s.SetOutputToWaveFile('" + wavPath.replace(/[']/g, "''") + "'); " +
  "$s.Speak('" + SENTENCE + "'); $s.Dispose();";
const encoded = Buffer.from(script, 'utf16le').toString('base64');
const spoken = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 120_000 });
if (spoken.status !== 0) throw new Error('SAPI synthesis failed: ' + spoken.stderr.toString());
const probeInput = await runTool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', wavPath]);
const inputDuration = Number(JSON.parse(probeInput.stdout).format.duration);
console.log('[1/4] input: ' + wavPath + ' (' + inputDuration.toFixed(2) + 's)');

console.log('[2/4] downloading paraformer weights through the store');
const job = await installModel(store, entry, {
  profile: 'mainland-china',
  onProgress: (j) => {
    if (j.totalBytes && j.bytes % (Math.ceil(j.totalBytes / 20)) < 400_000) process.stdout.write('.');
  },
});
if (job.state !== 'completed') {
  console.error('download failed: ' + job.error);
  process.exit(1);
}
console.log('\n[2/4] installed: ' + entry.id);

console.log('[3/4] ensuring isolated uv runtime');
const runtime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const env = await runtime.ensure('paraformer-asr', join(root, 'runners/paraformer-asr'), '3.12');
console.log('[3/4] runtime: ' + env.pythonPath);

console.log('[4/4] transcribing through the runner protocol');
const host = new RunnerHost({
  command: env.pythonPath,
  args: [join(root, 'runners/paraformer-asr/runner.py')],
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
  modelId: entry.id,
  modelFiles: {
    model: { path: store.filePath(entry.id, 'master', 'model.pt') },
    config: { path: store.filePath(entry.id, 'master', 'config.yaml') },
    am_mvn: { path: store.filePath(entry.id, 'master', 'am.mvn') },
    seg_dict: { path: store.filePath(entry.id, 'master', 'seg_dict') },
    tokens: { path: store.filePath(entry.id, 'master', 'tokens.json') },
    configuration: { path: store.filePath(entry.id, 'master', 'configuration.json') },
  },
  device: 'cpu',
}, 1_200_000);
if (!prepare.ok) throw new Error('prepare failed');
const execute = await host.execute({
  capability: 'audio.asr',
  modelId: entry.id,
  inputs: { audio: { path: wavPath } },
  settings: { durationUs: Math.round(inputDuration * 1_000_000) },
  outputDir: outDir,
}, 1_200_000);
host.dispose();
if (!execute.ok) throw new Error('execute failed');
const transcriptPath = execute.outputs.transcript.path;
const srtPath = execute.outputs.srt.path;
console.log('[4/4] transcript: ' + transcriptPath + ' (device ' + execute.metadata.device + ')');

console.log('[5/5] validating the transcript');
const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const srt = readFileSync(srtPath, 'utf8');
const cjk = (text) => text.replace(/[^\u4e00-\u9fff]/g, '');
const expected = cjk(SENTENCE);
const actual = cjk(transcript.text);
const hit = [...expected].filter((char) => actual.includes(char)).length;
const ratio = hit / expected.length;
console.log('[5/5] expected: ' + JSON.stringify(expected));
console.log('[5/5] transcript: ' + JSON.stringify(transcript.text));
console.log('[5/5] char overlap: ' + hit + '/' + expected.length + ' (' + ratio.toFixed(2) + ')');
console.log('[5/5] srt head:\n' + srt.split('\n').slice(0, 4).join('\n'));
if (transcript.segments.length === 0) throw new Error('no segments produced');
if (ratio < 0.85) throw new Error('char overlap too low: ' + ratio.toFixed(2));
if (!srt.includes(' --> ')) throw new Error('srt missing timings');
const manifest = store.manifest(entry.id, 'master');
console.log('[5/5] store manifest (for pinning):');
for (const file of manifest.files) console.log('  ' + file.path + ' ' + file.sha256);
console.log('VERIFY OK');

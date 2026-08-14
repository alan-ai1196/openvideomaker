#!/usr/bin/env node
/**
 * Real verification of generation jobs, end to end: a Kokoro TTS job
 * lands a voiceover asset with provenance, a Whisper ASR job on that
 * audio lands caption clips + a subtitle asset, and the resulting
 * project (durable JSON) is saved under .research/jobs-out/.
 * Re-runnable; reuses the already-installed models and runtimes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ProjectSession } from '@openvideomaker/core';
import { ModelStore } from '@openvideomaker/downloader';
import { Registry } from '@openvideomaker/registry';
import { attachGeneratedFile, attachGeneratedMedia, attachTranscriptCaptions, GenerationRunner } from '@openvideomaker/jobs';
import { runTool } from '@openvideomaker/media';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const store = new ModelStore(join(root, '.research/model-store'));
const outDir = join(root, '.research/jobs-out');
mkdirSync(outDir, { recursive: true });

const SENTENCE = 'Make videos with AI and keep everything editable.';
const runner = new GenerationRunner({
  registry,
  store,
  runnersDir: join(root, 'runners'),
  runtimesDir: join(root, '.research/runtimes'),
});
const session = ProjectSession.create('Generation Verification', { settings: { width: 1920, height: 1080 } });

console.log('[1/3] TTS generation job (Kokoro)');
const tts = runner.run({
  capability: 'audio.tts',
  modelId: 'hf/hexgrad/Kokoro-82M',
  inputs: { voice: { path: store.filePath('hf/hexgrad/Kokoro-82M', 'main', 'voices/af_heart.pt') } },
  settings: { text: SENTENCE },
  outputDir: join(outDir, 'tts'),
  provenanceInputs: [{ kind: 'text', role: 'script', text: SENTENCE }],
  device: 'cpu',
});
tts.subscribe((event) => {
  if (event.state === 'installing' || event.state === 'running' || event.state === 'preparing') process.stdout.write('.');
});
await tts.finished;
if (tts.state !== 'completed') {
  console.error('TTS job failed: ' + tts.error);
  process.exit(1);
}
const voiceAssetId = await attachGeneratedMedia(session, tts, 'audio', { name: 'Generated Voiceover' });
console.log('\n[1/3] voice asset ' + voiceAssetId + ' (' + (Number(tts.metadata.durationUs) / 1_000_000).toFixed(2) + 's)');

console.log('[2/3] ASR generation job (Whisper)');
const asr = runner.run({
  capability: 'audio.asr',
  modelId: 'hf/openai/whisper-large-v3',
  inputs: { audio: { path: tts.outputs.audio.path } },
  settings: { language: 'en' },
  outputDir: join(outDir, 'asr'),
  provenanceInputs: [{ kind: 'audio', role: 'source', assetId: voiceAssetId }],
  device: 'cuda',
});
asr.subscribe((event) => {
  if (event.state === 'running' || event.state === 'preparing') process.stdout.write('.');
});
await asr.finished;
if (asr.state !== 'completed') {
  console.error('ASR job failed: ' + asr.error);
  process.exit(1);
}
const transcriptText = JSON.parse(readFileSync(asr.outputs.transcript.path, 'utf8')).text;
console.log('\n[2/3] transcript: ' + JSON.stringify(transcriptText));

console.log('[3/3] landing captions + subtitle asset in the project');
const captions = attachTranscriptCaptions(session, asr, { audioAssetId: voiceAssetId });
const srtAssetId = attachGeneratedFile(session, asr, 'srt', 'subtitle', { name: 'Generated Subtitles' });
console.log('[3/3] caption clips: ' + captions.segmentCount + ' on track ' + captions.trackId + '; srt asset ' + srtAssetId);

const asset = session.project.assets[voiceAssetId];
if (!asset || asset.origin.kind !== 'generated') throw new Error('voice asset missing provenance');
if (asset.origin.provenance.capability !== 'audio.tts') throw new Error('wrong capability on voice asset');
if (asset.origin.provenance.model.id !== 'hf/hexgrad/Kokoro-82M') throw new Error('wrong model on voice asset');
const sequenceIds = Object.keys(session.project.sequences);
const seq = sequenceIds.map((id) => session.project.sequences[id]).find((s) => s?.tracks.some((t) => t.id === captions.trackId));
if (!seq) throw new Error('caption track not found in any sequence');
const track = seq.tracks.find((t) => t.id === captions.trackId);
if (!track) throw new Error('caption track not found');
if (track.clips.length !== captions.segmentCount) throw new Error('caption clip count mismatch');
const firstClip = track.clips[0];
if (!firstClip || firstClip.provenance?.capability !== 'audio.asr') throw new Error('caption clip missing ASR provenance');

console.log('[4/4] background-removal generation job (IS-Net)');
const cutoutInput = join(outDir, 'cutout-input.png');
const fixtureMade = await runTool('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=white:s=480x360',
  '-vf', 'drawbox=x=120:y=60:w=240:h=240:color=darkred@1:t=fill',
  '-frames:v', '1', cutoutInput,
], { timeoutMs: 120_000 });
if (fixtureMade.code !== 0) throw new Error('cutout fixture failed: ' + fixtureMade.stderr);
const rmbg = runner.run({
  capability: 'media.background_remove',
  modelId: 'gh/danielgatis/rembg-isnet-general-use',
  inputs: { image: { path: cutoutInput } },
  settings: {},
  outputDir: join(outDir, 'rmbg'),
  provenanceInputs: [],
  device: 'cpu',
});
rmbg.subscribe((event) => {
  if (event.state === 'installing' || event.state === 'running' || event.state === 'preparing') process.stdout.write('.');
});
await rmbg.finished;
if (rmbg.state !== 'completed') {
  console.error('background-removal job failed: ' + rmbg.error);
  process.exit(1);
}
const cutoutAssetId = await attachGeneratedMedia(session, rmbg, 'image', { name: 'Generated Cutout' });
console.log('\n[4/4] cutout asset ' + cutoutAssetId + ' (' + (rmbg.metadata.width ?? '?') + 'x' + (rmbg.metadata.height ?? '?') + ')');
const cutoutAsset = session.project.assets[cutoutAssetId];
if (!cutoutAsset || cutoutAsset.origin.kind !== 'generated') throw new Error('cutout asset missing provenance');
if (cutoutAsset.kind !== 'image') throw new Error('cutout asset is not an image: ' + cutoutAsset.kind);
if (cutoutAsset.origin.provenance.capability !== 'media.background_remove') throw new Error('wrong capability on cutout asset');
if (cutoutAsset.origin.provenance.model.id !== 'gh/danielgatis/rembg-isnet-general-use') throw new Error('wrong model on cutout asset');
// Objective alpha evidence through the runner's own analyzer (the runtime
// exists once the job completed; a fresh clone runs it the same way).
const rmbgPython = join(root, '.research/runtimes/rmbg/Scripts/python.exe');
if (existsSync(rmbgPython)) {
  const analyzed = spawnSync(rmbgPython, [join(root, 'runners/rmbg/analyze.py'), rmbg.outputs.image.path, 'synthetic'], { encoding: 'utf8' });
  if (analyzed.status !== 0) throw new Error('cutout analysis failed: ' + analyzed.stderr);
  const stats = JSON.parse(analyzed.stdout.trim().split(/\r?\n/).pop());
  console.log('[4/4] alpha stats: ' + JSON.stringify(stats));
  if (!(stats.alphaGap > 0.2)) throw new Error('cutout separation too weak: ' + JSON.stringify(stats));
}

const projectJson = join(outDir, 'project.json');
writeFileSync(projectJson, JSON.stringify({ project: session.project }, null, 2));
console.log('saved project: ' + projectJson);
console.log('VERIFY OK');

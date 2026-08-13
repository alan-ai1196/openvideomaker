#!/usr/bin/env node
/**
 * Real verification of generation jobs, end to end: a Kokoro TTS job
 * lands a voiceover asset with provenance, a Whisper ASR job on that
 * audio lands caption clips + a subtitle asset, and the resulting
 * project (durable JSON) is saved under .research/jobs-out/.
 * Re-runnable; reuses the already-installed models and runtimes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectSession } from '@openvideomaker/core';
import { ModelStore } from '@openvideomaker/downloader';
import { Registry } from '@openvideomaker/registry';
import { attachGeneratedFile, attachGeneratedMedia, attachTranscriptCaptions, GenerationRunner } from '@openvideomaker/jobs';

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

const projectJson = join(outDir, 'project.json');
writeFileSync(projectJson, JSON.stringify({ project: session.project }, null, 2));
console.log('saved project: ' + projectJson);
console.log('VERIFY OK');

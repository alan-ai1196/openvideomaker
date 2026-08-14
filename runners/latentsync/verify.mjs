#!/usr/bin/env node
/**
 * Real verification of the LatentSync runner, end to end:
 * artifact store -> isolated uv runtime -> runner protocol -> synced
 * mp4 -> ffprobe + extracted frames. Re-runnable; artifacts land under
 * .research/. (The jobs layer is exercised by packages/jobs/verify.mjs;
 * this script proves the adapter itself.)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runTool, probeMediaPath } from '@openvideomaker/media';
import { Registry } from '@openvideomaker/registry';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, UvRuntime } from '@openvideomaker/runners';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const entry = registry.byId('hf/bytedance/latentsync-1.5');
if (!entry) throw new Error('latentsync entry missing');

const outDir = join(root, '.research/latentsync-out');
mkdirSync(outDir, { recursive: true });
const videoSrc = join(root, '.research/upstream/latentsync/assets/demo1_video.mp4');
const audioSrc = join(root, '.research/upstream/latentsync/assets/demo1_audio.wav');
if (!existsSync(videoSrc) || !existsSync(audioSrc)) {
  console.error('upstream demo assets missing - clone .research/upstream/latentsync first');
  process.exit(1);
}

// A short clip keeps verification fast: first 5 seconds at 25fps.
const clipVideo = join(outDir, 'in.mp4');
const clipAudio = join(outDir, 'in.wav');
const trimmed = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoSrc, '-t', '5', '-r', '25', '-c:v', 'libx264', '-an', clipVideo]);
if (trimmed.code !== 0) throw new Error('trim failed: ' + trimmed.stderr);
const audioTrimmed = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', audioSrc, '-t', '5', '-ar', '16000', '-ac', '1', clipAudio]);
if (audioTrimmed.code !== 0) throw new Error('audio trim failed: ' + audioTrimmed.stderr);

console.log('[1/4] model artifacts through the store');
const store = new ModelStore(join(root, '.research/model-store'));
const install = await installModel(store, entry);
if (install.state !== 'completed') throw new Error('install failed: ' + install.error);

console.log('[2/4] isolated uv runtime');
const runtime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const env = await runtime.ensure('latentsync', here, '3.12');

console.log('[3/4] lip-sync through the runner protocol (CUDA)');
const manifest = JSON.parse(readFileSync(join(here, 'runner.json'), 'utf8'));
const modelFiles = Object.fromEntries(
  Object.entries(manifest.modelFiles).map(([key, path]) => [key, { path: store.filePath(entry.id, 'main', path) }]),
);
const host = new RunnerHost({ command: env.pythonPath, args: [join(here, 'runner.py')], envAllow: [] });
host.subscribe((event) => {
  if (event.kind === 'log') console.log('  [runner] ' + event.message);
});
host.start();
try {
  const description = await host.describe(120_000);
  if (!('protocolVersion' in description)) throw new Error('describe failed');
  const prepare = await host.prepare({ capability: 'avatar.lip_sync', modelId: entry.id, modelFiles, device: 'cuda' }, 900_000);
  if (!('estimate' in prepare)) throw new Error('prepare failed');
  const execute = await host.execute(
    {
      capability: 'avatar.lip_sync',
      modelId: entry.id,
      inputs: { video: { path: clipVideo }, audio: { path: clipAudio } },
      settings: { inference_steps: 10, guidance_scale: 1.5, deepcache: true, seed: 1247 },
      outputDir: join(outDir, 'run'),
    },
    1_800_000,
  );
  if (!('outputs' in execute)) throw new Error('execute failed');
  console.log('[3/4] output: ' + execute.outputs.video.path);

  console.log('[4/4] probing the synced video');
  const probe = await probeMediaPath(execute.outputs.video.path);
  const duration = (probe.media.durationUs ?? 0) / 1_000_000;
  if (!probe.media.hasVideo || !probe.media.hasAudio) throw new Error('output missing video/audio streams');
  if (duration < 4 || duration > 6) throw new Error('unexpected output duration: ' + duration);
  console.log('[4/4] ' + duration.toFixed(2) + 's, ' + probe.media.width + 'x' + probe.media.height + ', video+audio OK');

  const frame = join(root, '.research/screenshots/latentsync-frame.png');
  const shot = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', execute.outputs.video.path, '-vf', 'select=eq(n\\,60)', '-frames:v', '1', frame]);
  if (shot.code === 0) console.log('[4/4] frame: ' + frame);
  else console.warn('frame extraction skipped: ' + shot.stderr);

  writeFileSync(join(outDir, 'result.json'), JSON.stringify({
    state: 'completed',
    modelId: entry.id,
    capability: 'avatar.lip_sync',
    output: execute.outputs.video.path,
    durationSeconds: duration,
    width: probe.media.width,
    height: probe.media.height,
  }, null, 2));
} finally {
  host.dispose();
}

// The adapter must provide EVERYTHING insightface needs: a runtime
// download would leave models/buffalo_l.zip next to the unpacked files.
const auxZip = store.filePath(entry.id, 'main', 'auxiliary/buffalo_l.zip');
const { statSync } = await import('node:fs');
const auxDir = join(tmpdir(), 'ovm-latentsync-aux-' + statSync(auxZip).size);
const modelDir = join(auxDir, 'models', 'buffalo_l');
if (!existsSync(join(modelDir, 'det_10g.onnx')) || !existsSync(join(modelDir, '2d106det.onnx'))) {
  throw new Error('insightface models not unpacked by the adapter');
}
if (existsSync(join(auxDir, 'models', 'buffalo_l.zip'))) {
  throw new Error('insightface downloaded models at runtime - the adapter must prevent that');
}
console.log('no runtime download - adapter provided the face models');
console.log('VERIFY OK');
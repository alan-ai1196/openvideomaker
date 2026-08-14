#!/usr/bin/env node
/**
 * Real verification of the upscale runner (video.upscale), end to end:
 * artifact store download -> isolated uv runtime -> runner protocol ->
 * 4x output -> PSNR against the true high-resolution reference, which
 * must beat the bicubic baseline (the model restores real detail).
 * Re-runnable; artifacts land under .research/.
 */
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTool } from '@openvideomaker/media';
import { Registry } from '@openvideomaker/registry';
import { installModel, ModelStore } from '@openvideomaker/downloader';
import { RunnerHost, UvRuntime } from '@openvideomaker/runners';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const registry = Registry.fromData(JSON.parse(readFileSync(join(root, 'packages/registry/src/data/index.json'), 'utf8')));
const entry = registry.byId('gh/xinntao/Real-ESRGAN-x4plus');
if (!entry) throw new Error('Real-ESRGAN entry missing');
const outDir = join(root, '.research/upscale-out');
mkdirSync(outDir, { recursive: true });
const store = new ModelStore(join(root, '.research/model-store'));

console.log('[1/5] downloading model artifacts through the store');
const job = await installModel(store, entry, {
  profile: 'auto',
  onProgress: (j) => {
    if (j.totalBytes && j.bytes % (Math.ceil(j.totalBytes / 20)) < 200000) process.stdout.write('.');
  },
});
if (job.state !== 'completed') {
  console.error('download failed: ' + job.error);
  process.exit(1);
}
console.log('\n[1/5] installed: ' + entry.id);

console.log('[2/5] ensuring isolated uv runtime');
const runtime = new UvRuntime({ runtimesDir: join(root, '.research/runtimes') });
const env = await runtime.ensure('upscale', join(root, 'runners/upscale'), '3.12');
console.log('[2/5] runtime: ' + env.pythonPath);

console.log('[3/5] preparing the low-res input + true reference');
const demoVideo = join(root, '.research/upstream/latentsync/assets/demo1_video.mp4');
const referencePath = join(outDir, 'reference.png');
const inputPath = join(outDir, 'input.png');
let mode = 'face';
if (existsSync(demoVideo)) {
  const frame = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', demoVideo, '-ss', '0.5', '-frames:v', '1', referencePath]);
  if (frame.code !== 0) throw new Error('frame extraction failed: ' + frame.stderr);
} else {
  mode = 'synthetic';
  const made = spawnSync(env.pythonPath, ['-c', 'from PIL import Image, ImageDraw; import numpy as np, sys; rng = np.random.default_rng(11); base = rng.integers(0, 255, (270, 480, 3), dtype=np.uint8); img = Image.fromarray(base); d = ImageDraw.Draw(img); [d.line([(i, 0), (i, 269)], fill=(240, 90, 60), width=1) for i in range(0, 480, 12)]; img.save(sys.argv[1])', referencePath], { stdio: 'inherit' });
  if (made.status !== 0) throw new Error('synthetic fixture failed');
}
const down = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', referencePath, '-vf', 'scale=iw/4:ih/4', inputPath]);
if (down.code !== 0) throw new Error('downscale failed: ' + down.stderr);
console.log('[3/5] input: 4x-downscaled ' + mode + ' frame');

console.log('[4/5] running video.upscale through the runner protocol');
const host = new RunnerHost({
  command: env.pythonPath,
  args: [join(root, 'runners/upscale/runner.py')],
  envAllow: [],
});
host.subscribe((event) => {
  if (event.kind === 'log') console.log('  [runner] ' + event.message);
});
host.start();
const description = await host.describe(120_000);
if (!description.ok) throw new Error('describe failed');
const prepare = await host.prepare({
  capability: 'video.upscale',
  modelId: entry.id,
  modelFiles: { model: { path: store.filePath(entry.id, 'main', 'RealESRGAN_x4plus.pth') } },
  device: 'cuda',
}, 600_000);
if (!prepare.ok) throw new Error('prepare failed');
const execute = await host.execute({
  capability: 'video.upscale',
  modelId: entry.id,
  inputs: { image: { path: inputPath } },
  settings: { scale: 4 },
  outputDir: outDir,
}, 900_000);
host.dispose();
if (!execute.ok) throw new Error('execute failed: ' + JSON.stringify(execute.error));
const upscaledPath = execute.outputs.image.path;
console.log('[4/5] generated: ' + upscaledPath + ' (' + execute.metadata.width + 'x' + execute.metadata.height + ' in ' + execute.metadata.elapsedMs + 'ms)');

console.log('[5/5] measuring quality against the true reference');
const analyzed = spawnSync(env.pythonPath, [join(root, 'runners/upscale/analyze.py'), upscaledPath, referencePath], { encoding: 'utf8' });
if (analyzed.status !== 0) throw new Error('analysis failed: ' + analyzed.stderr);
const stats = JSON.parse(analyzed.stdout.trim().split(/\r?\n/).pop());
console.log('[5/5] ' + JSON.stringify(stats));
if (stats.width % 4 !== 0 || stats.height % 4 !== 0) throw new Error('unexpected output size: ' + stats.width + 'x' + stats.height);
// GAN restoration: the model must restore high-frequency detail - sharper
// than bicubic on both metrics, approaching the true reference.
if (!(stats.modelSharpness > stats.bicubicSharpness * 1.05)) throw new Error('model is not sharper than bicubic: ' + JSON.stringify(stats));
if (!(stats.modelEdgeEnergy > stats.bicubicEdgeEnergy * 1.05)) throw new Error('model restores no edge detail: ' + JSON.stringify(stats));
console.log('VERIFY OK (' + mode + ')');

#!/usr/bin/env node
/**
 * Real verification of the rmbg runner (media.background_remove), end
 * to end: artifact store download -> isolated uv runtime -> runner
 * protocol -> RGBA cutout -> objective alpha statistics. Re-runnable;
 * artifacts land under .research/.
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
const entry = registry.byId('gh/danielgatis/rembg-isnet-general-use');
if (!entry) throw new Error('isnet entry missing');
const outDir = join(root, '.research/rmbg-out');
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
const env = await runtime.ensure('rmbg', join(root, 'runners/rmbg'), '3.12');
console.log('[2/5] runtime: ' + env.pythonPath);

console.log('[3/5] preparing the test image');
const demoVideo = join(root, '.research/upstream/latentsync/assets/demo1_video.mp4');
const inputPath = join(outDir, 'input.png');
let mode = 'face';
if (existsSync(demoVideo)) {
  const frame = await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', demoVideo, '-ss', '0.5', '-frames:v', '1', inputPath]);
  if (frame.code !== 0) throw new Error('frame extraction failed: ' + frame.stderr);
  console.log('[3/5] input: real frame from the upstream demo (face on a plain background)');
} else {
  mode = 'synthetic';
  const made = spawnSync(env.pythonPath, [join(root, 'runners/rmbg/make_fixture.py'), inputPath], { stdio: 'inherit' });
  if (made.status !== 0) throw new Error('fixture generation failed');
  console.log('[3/5] input: synthetic subject on a textured background (demo clone absent)');
}

console.log('[4/5] running media.background_remove through the runner protocol');
const host = new RunnerHost({
  command: env.pythonPath,
  args: [join(root, 'runners/rmbg/runner.py')],
  envAllow: [],
});
host.subscribe((event) => {
  if (event.kind === 'log') console.log('  [runner] ' + event.message);
});
host.start();
const description = await host.describe(60_000);
if (!description.ok) throw new Error('describe failed');
const prepare = await host.prepare({
  capability: 'media.background_remove',
  modelId: entry.id,
  modelFiles: { model: { path: store.filePath(entry.id, 'main', 'isnet-general-use.onnx') } },
  device: 'cpu',
}, 600_000);
if (!prepare.ok) throw new Error('prepare failed');
const execute = await host.execute({
  capability: 'media.background_remove',
  modelId: entry.id,
  inputs: { image: { path: inputPath } },
  settings: {},
  outputDir: outDir,
}, 600_000);
host.dispose();
if (!execute.ok) throw new Error('execute failed: ' + JSON.stringify(execute.error));
const cutoutPath = execute.outputs.image.path;
console.log('[4/5] generated: ' + cutoutPath + ' (' + execute.metadata.width + 'x' + execute.metadata.height + ' in ' + execute.metadata.elapsedMs + 'ms)');

console.log('[5/5] measuring the alpha matte');
const analyzed = spawnSync(env.pythonPath, [join(root, 'runners/rmbg/analyze.py'), cutoutPath, mode], { encoding: 'utf8' });
if (analyzed.status !== 0) throw new Error('analysis failed: ' + analyzed.stderr);
const stats = JSON.parse(analyzed.stdout.trim().split(/\r?\n/).pop());
console.log('[5/5] alpha stats: ' + JSON.stringify(stats));
const threshold = mode === 'face' ? { subject: 0.6, background: 0.15, gap: 0.4 } : { subject: 0.55, background: 0.2, gap: 0.35 };
if (stats.subjectAlpha < threshold.subject) throw new Error('subject too transparent: ' + stats.subjectAlpha);
if (stats.backgroundAlpha > threshold.background) throw new Error('background not removed: ' + stats.backgroundAlpha);
if (stats.alphaGap < threshold.gap) throw new Error('subject/background separation too weak: ' + stats.alphaGap);
console.log('VERIFY OK (' + mode + ')');

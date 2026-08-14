#!/usr/bin/env node
/**
 * Reframe verification: a 16:9 project is reframed to vertical through
 * the core command, then REALLY rendered - the output must be 1080x1920
 * (the render pipeline applies the center crop). Re-runnable; artifacts
 * land under .research/.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { importedAsset, mediaClip, ProjectSession, reframeToVertical } from '@openvideomaker/core';
import { buildRenderPlan, runRenderJob, RenderJob } from '@openvideomaker/render';
import { runTool } from '@openvideomaker/media';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, '.research/reframe-out');
mkdirSync(outDir, { recursive: true });

console.log('[1/3] building a 16:9 project');
const sourcePath = join(outDir, 'source.mp4');
const made = await runTool('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=gray:s=1920x1080:d=2',
  '-vf', 'drawbox=x=400:y=300:w=400:h=400:color=red@1:t=fill',
  '-c:v', 'libx264', '-preset', 'ultrafast', sourcePath,
], { timeoutMs: 120_000 });
if (made.code !== 0) throw new Error('source generation failed: ' + made.stderr);

const session = ProjectSession.create('Reframe check');
const sequenceId = session.project.activeSequenceId ?? Object.keys(session.project.sequences)[0];
const asset = importedAsset({ kind: 'video', name: 'source.mp4', path: sourcePath, media: { durationUs: 2_000_000, hasVideo: true, hasAudio: false, width: 1920, height: 1080, fps: { num: 25, den: 1 } } });
session.transaction((tx) => {
  tx.importAsset({ asset });
  const trackId = tx.newTrackId();
  tx.createTrack({ sequenceId, trackId, kind: 'video', name: 'V1' });
  tx.insertClip({ sequenceId, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 2_000_000 }) });
});
const result = reframeToVertical(session);
if (!result || result.reframedClips !== 1) throw new Error('reframe did not crop the clip: ' + JSON.stringify(result));
console.log('[1/3] reframed 1 clip; project ' + session.project.settings.width + 'x' + session.project.settings.height);

console.log('[2/3] rendering the reframed project');
const outputPath = join(outDir, 'out.mp4');
const plan = await buildRenderPlan(
  session.project,
  { width: session.project.settings.width, height: session.project.settings.height, fps: session.project.settings.fps, sampleRate: 48000, quality: 'draft', encoderPreference: 'auto', outputPath },
  (assetId) => {
    const a = session.project.assets[assetId];
    return a && a.source.kind === 'file' ? a.source.path : null;
  },
);
const job = new RenderJob('reframe-render');
await runRenderJob(plan, job);
if (job.state !== 'completed') throw new Error('render failed: ' + (job.error ?? job.state));

console.log('[3/3] probing the output');
const probe = await runTool('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', outputPath]);
const info = JSON.parse(probe.stdout);
const stream = info.streams[0];
console.log('[3/3] output: ' + stream.width + 'x' + stream.height);
if (stream.width !== 1080 || stream.height !== 1920) throw new Error('expected 1080x1920 output, got ' + stream.width + 'x' + stream.height);
console.log('VERIFY OK');

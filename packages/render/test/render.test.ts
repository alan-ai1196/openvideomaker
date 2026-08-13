import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMediaPath, runTool } from '@openvideomaker/media';
import { captionClip, importedAsset, mediaClip, ProjectSession, textClip } from '@openvideomaker/core';
import { COMMON_FPS, type Project } from '@openvideomaker/schema';
import { buildRenderPlan, classifyRenderError, chooseVideoEncoder, detectEncoders, render, runRenderJob, RenderJob } from '@openvideomaker/render';

const dir = mkdtempSync(join(tmpdir(), 'ovm-render-'));
const videoPath = join(dir, 'clip-a.mp4');
const audioPath = join(dir, 'music.wav');
const outPath = join(dir, 'out.mp4');

beforeAll(async () => {
  const v = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
    '-shortest', '-t', '3', '-y', videoPath,
  ], { timeoutMs: 120_000 });
  if (v.code !== 0) throw new Error('sample video generation failed: ' + v.stderr);
  const a = await runTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
    '-c:a', 'pcm_s16le', '-y', audioPath,
  ], { timeoutMs: 120_000 });
  if (a.code !== 0) throw new Error('sample audio generation failed: ' + a.stderr);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildProject(): Project {
  const session = ProjectSession.create('Render Test', { settings: { width: 640, height: 360, fps: COMMON_FPS.FPS_30 } });
  const sequenceId = Object.keys(session.project.sequences)[0]!;
  const clip = importedAsset({ kind: 'video', name: 'clip-a.mp4', path: videoPath, media: { durationUs: 3_000_000, hasVideo: true, hasAudio: true, width: 640, height: 360, fps: COMMON_FPS.FPS_30 } });
  const music = importedAsset({ kind: 'audio', name: 'music.wav', path: audioPath, media: { durationUs: 3_000_000, hasVideo: false, hasAudio: true, sampleRate: 44100, audioChannels: 2 } });
  session.transaction((tx) => {
    tx.importAsset({ asset: clip });
    tx.importAsset({ asset: music });
    tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'video', name: 'Video 1' });
    tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'audio', name: 'Audio 1' });
    tx.createTrack({ sequenceId, trackId: tx.newTrackId(), kind: 'text', name: 'Text 1' });
  });
  const videoTrack = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'audio')!;
  const textTrack = session.project.sequences[sequenceId]!.tracks.find((t) => t.kind === 'text')!;
  session.transaction((tx) => {
    tx.insertClip({ sequenceId, trackId: videoTrack.id, clip: mediaClip({ trackId: videoTrack.id, assetId: clip.id, start: 0, duration: 3_000_000, opacity: 0.9 }) });
    tx.insertClip({ sequenceId, trackId: audioTrack.id, clip: mediaClip({ trackId: audioTrack.id, assetId: music.id, start: 0, duration: 3_000_000, audio: { gain: 0.8, muted: false, fadeInUs: 250_000, fadeOutUs: 250_000 } }) });
    tx.insertClip({ sequenceId, trackId: textTrack.id, clip: textClip({ trackId: textTrack.id, start: 0, duration: 2_000_000, content: "Hello, render!" }) });
    tx.insertClip({ sequenceId, trackId: textTrack.id, clip: captionClip({ trackId: textTrack.id, start: 2_000_000, duration: 1_000_000, segments: [{ text: 'Caption line one', start: 0, end: 500_000 }, { text: 'Caption line two', start: 500_000, end: 1_000_000 }] }) });
  });
  return session.project;
}

describe('encoder detection', () => {
  it('detects real encoders from this ffmpeg build', async () => {
    const report = await detectEncoders();
    expect(report.software.map((e) => e.name)).toContain('libx264');
    expect(report.software.map((e) => e.name)).toContain('libx265');
    expect(report.hardware.length).toBeGreaterThanOrEqual(0);
  });

  it('falls back to software when hardware is unavailable', () => {
    const choice = chooseVideoEncoder({ software: [{ name: 'libx264', codec: 'h264', hardware: false }], hardware: [] }, 'auto');
    expect(choice.name).toBe('libx264');
    expect(choice.hardware).toBe(false);
  });

  it('respects explicit software preference', async () => {
    const report = await detectEncoders();
    const choice = chooseVideoEncoder(report, 'software');
    expect(choice.hardware).toBe(false);
    expect(choice.codec).toBe('h264');
  });
});

describe('buildRenderPlan', () => {
  it('plans video, audio mix, text and captions', async () => {
    const project = buildProject();
    const plan = await buildRenderPlan(
      project,
      { width: 640, height: 360, fps: COMMON_FPS.FPS_30, sampleRate: 48000, outputPath: outPath },
      (assetId) => project.assets[assetId]!.source.kind === 'file' ? project.assets[assetId]!.source.path : null,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.durationUs).toBe(3_000_000);
    expect(plan.sources).toHaveLength(2);
    expect(plan.filterComplex).toContain('overlay=');
    expect(plan.filterComplex).toContain('amix=inputs=');
    expect(plan.filterComplex).toContain('drawtext');
    expect(plan.filterComplex).toContain('subtitles');
    expect(plan.filterComplex).toContain('adelay=');
    expect(plan.textClipCount).toBe(1);
    expect(plan.captionCueCount).toBe(2);
  });

  it('reports missing sources as errors', async () => {
    const project = buildProject();
    const plan = await buildRenderPlan(
      project,
      { width: 640, height: 360, fps: COMMON_FPS.FPS_30, sampleRate: 48000, outputPath: outPath },
      () => null,
    );
    expect(plan.errors.length).toBeGreaterThan(0);
  });
});

describe('end-to-end render', () => {
  it('renders a real mp4 with video, audio, captions and text', async () => {
    const project = buildProject();
    const plan = await buildRenderPlan(
      project,
      { width: 640, height: 360, fps: COMMON_FPS.FPS_30, sampleRate: 48000, outputPath: outPath, quality: 'draft' },
      (assetId) => project.assets[assetId]!.source.kind === 'file' ? project.assets[assetId]!.source.path : null,
    );
    const job = await render(plan, 'render-e2e');
    expect(job.state).toBe('completed');
    expect(job.progress).toBe(1);
    const { media } = await probeMediaPath(outPath);
    expect(media.hasVideo).toBe(true);
    expect(media.hasAudio).toBe(true);
    expect(media.width).toBe(640);
    expect(media.height).toBe(360);
    expect(media.durationUs).toBeGreaterThan(2_700_000);
    expect(media.durationUs).toBeLessThan(3_300_000);
  }, 180_000);

  it('supports cancellation', async () => {
    const project = buildProject();
    const plan = await buildRenderPlan(
      project,
      { width: 1280, height: 720, fps: COMMON_FPS.FPS_30, sampleRate: 48000, outputPath: join(dir, 'cancel.mp4'), quality: 'high' },
      (assetId) => project.assets[assetId]!.source.kind === 'file' ? project.assets[assetId]!.source.path : null,
    );
    const job = new RenderJob('render-cancel');
    const pending = runRenderJob(plan, job);
    setTimeout(() => job.cancel(), 400);
    const finished = await pending;
    expect(finished.state).toBe('cancelled');
  }, 60_000);

  it('fails loudly for a missing output directory input', async () => {
    const project = buildProject();
    const plan = await buildRenderPlan(
      project,
      { width: 640, height: 360, fps: COMMON_FPS.FPS_30, sampleRate: 48000, outputPath: outPath },
      (assetId) => project.assets[assetId]!.source.kind === 'file' ? project.assets[assetId]!.source.path : null,
    );
    const missing = { ...plan, sources: [{ ...plan.sources[0]!, path: join(dir, 'gone.mp4') }] };
    const job = await render(missing, 'render-missing');
    expect(job.state).toBe('failed');
    expect(job.error).toContain('source file could not be found');
  }, 60_000);
});

describe('classifyRenderError', () => {
  it('maps technical failures to creator language', () => {
    expect(classifyRenderError('CUDA out of memory')).toContain('more memory');
    expect(classifyRenderError('Unknown encoder h264_fake')).toContain('software encoder');
  });
});

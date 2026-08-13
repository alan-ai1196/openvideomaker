import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachAsrResult, generatedAsset, importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import { ProjectStore } from '@openvideomaker/persistence';
import { probeDeviceGraph } from '@openvideomaker/devices';
import { probeMediaPath, runTool } from '@openvideomaker/media';
import { buildRenderPlan, RenderJob, runRenderJob } from '@openvideomaker/render';
import type { GenerationJob } from '@openvideomaker/jobs';
import type { Project, ProjectLog } from '@openvideomaker/schema';
import {
  DesktopGenerateRequestSchema,
  DesktopGenerationService,
  describeJobOutputs,
  type DesktopGenerateRequest,
  type DesktopGenerateResult,
  type DesktopOutput,
} from './generation.js';

/**
 * Desktop shell: one Electron window around the SAME Studio UI. The
 * renderer stays sandboxed (contextIsolation, no node integration) and
 * reaches local powers only through the narrow typed preload bridge:
 * persistence, device probing, rendering, generation, and a read-only
 * ovm-media:// protocol limited to files the user already gave the app.
 */

const here = dirname(fileURLToPath(import.meta.url));
const studioDist = resolve(here, '../../studio/dist');
let currentProjectDir: string | null = null;
let generationService: DesktopGenerationService | null = null;

// Privileged before app ready: the renderer may stream local media files
// through this protocol. It never serves arbitrary files - see the
// whitelist below, which only ever holds paths the user imported,
// generated, rendered or opened as a project.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ovm-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** Known local media paths: imported files, generated outputs, project assets. */
const mediaWhitelist = new Set<string>();

function normalizeMediaPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function allowMediaPath(path: string): void {
  mediaWhitelist.add(normalizeMediaPath(path));
}

function isMediaAllowed(path: string): boolean {
  return mediaWhitelist.has(normalizeMediaPath(path));
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function registerMediaProtocol(): void {
  protocol.handle('ovm-media', async (request) => {
    try {
      const url = new URL(request.url);
      const requested = resolve(decodeURIComponent(url.pathname.slice(1)));
      if (!isMediaAllowed(requested)) return new Response('forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(requested).toString());
      return new Response(response.body, {
        status: response.status,
        headers: {
          'content-type': CONTENT_TYPES[extname(requested).toLowerCase()] ?? 'application/octet-stream',
          'accept-ranges': 'bytes',
        },
      });
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
}

/**
 * The local generation backend: the SAME GenerationRunner the SDK/CLI
 * use (registry + content store + uv runtimes + runner protocol), driven
 * by runner manifests. When it cannot build (missing registry/runners),
 * localGeneration stays honestly false.
 */
function buildGenerationService(): void {
  try {
    const root = process.env.OVM_ROOT ?? resolve(here, '../../..');
    const registryPath = join(root, 'packages/registry/src/data/index.json');
    const runnersDir = join(root, 'runners');
    if (!existsSync(registryPath) || !existsSync(runnersDir)) {
      console.warn('desktop: generation service unavailable (registry or runners not found)');
      return;
    }
    const home = process.env.OVM_HOME ?? (app.isPackaged ? app.getPath('userData') : join(root, '.research'));
    generationService = new DesktopGenerationService({
      registryData: JSON.parse(readFileSync(registryPath, 'utf8')),
      storeDir: join(home, 'model-store'),
      runnersDir,
      runtimesDir: join(home, 'runtimes'),
      outputRoot: join(home, 'generated'),
      allowInputPath: isMediaAllowed,
    });
    console.log('desktop: generation service ready - ' + generationService.capabilities().length + ' capability/model pairs');
  } catch (err) {
    console.warn('desktop: generation service failed to build: ' + (err as Error).message);
  }
}

function failedGenerate(message: string): DesktopGenerateResult {
  return { jobId: '', state: 'failed', outputs: {}, metadata: {}, provenance: null, error: message };
}

function registerIpc(): void {
  ipcMain.handle('ovm:capabilities', () => ({
    desktop: true,
    localPersistence: true,
    localRender: true,
    localGeneration: generationService !== null,
  }));

  ipcMain.handle('ovm:generation-capabilities', () => ({ models: generationService?.capabilities() ?? [] }));

  ipcMain.handle('ovm:open-project', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Open an OpenVideoMaker project' });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0]!;
    const store = ProjectStore.open(dir);
    const loaded = store.load();
    store.close();
    currentProjectDir = dir;
    for (const asset of Object.values(loaded.project.assets)) {
      if (asset.source.kind === 'file') allowMediaPath(asset.source.path);
    }
    return { project: loaded.project, log: loaded.log } satisfies { project: Project; log: ProjectLog };
  });

  ipcMain.handle('ovm:save-project', async (_event, payload: { project: Project; log: ProjectLog }) => {
    if (!currentProjectDir) {
      const result = await dialog.showSaveDialog({ properties: ['createDirectory', 'showOverwriteConfirmation'], title: 'Save project as' });
      if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
      currentProjectDir = result.filePath;
    }
    try {
      const store = existsSync(join(currentProjectDir, 'meta.json'))
        ? ProjectStore.open(currentProjectDir)
        : ProjectStore.create(currentProjectDir, payload.project.id);
      const saved = store.save(payload.project, payload.log);
      store.close();
      return { ok: true, appended: saved.appended, dir: currentProjectDir };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  });

  ipcMain.handle('ovm:doctor', () => probeDeviceGraph());

  ipcMain.handle('ovm:import-media', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Import media',
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const imported: Array<{ path: string; name: string; media: unknown }> = [];
    for (const filePath of result.filePaths) {
      try {
        const probe = await probeMediaPath(filePath);
        imported.push({ path: filePath, name: filePath.split(/[\\/]/).pop() ?? filePath, media: probe.media });
        allowMediaPath(filePath);
      } catch {
        // Unprobeable files are skipped, not fatal.
      }
    }
    return imported;
  });

  ipcMain.handle('ovm:render', async (event, payload) => {
    let outputPath = payload.outputPath;
    if (!outputPath) {
      const result = await dialog.showSaveDialog({
        title: 'Render video',
        defaultPath: 'video.mp4',
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      });
      if (result.canceled || !result.filePath) return { state: 'cancelled', outputPath: undefined, error: null };
      outputPath = result.filePath;
    }
    const job = await renderProjectLocal({ ...payload, outputPath }, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('ovm:render-progress', progress);
    });
    if (job.state === 'completed' && outputPath) allowMediaPath(outputPath);
    return { state: job.state, outputPath: job.state === 'completed' ? job.outputPath : undefined, error: job.error };
  });

  ipcMain.handle('ovm:generate', async (event, payload) => {
    if (!generationService) return failedGenerate('generation service unavailable on this computer');
    const parsed = DesktopGenerateRequestSchema.safeParse(payload);
    if (!parsed.success) return failedGenerate('invalid generate request: ' + (parsed.error.issues[0]?.message ?? 'unknown'));
    try {
      const job = generationService.generate(parsed.data);
      job.subscribe((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ovm:generate-progress', {
            jobId: job.id,
            state: progress.state,
            stage: progress.stage,
            progress: progress.progress,
            bytes: progress.bytes,
            totalBytes: progress.totalBytes,
          });
        }
      });
      await job.finished;
      const outputs = job.state === 'completed' ? await describeJobOutputs(job) : {};
      for (const output of Object.values(job.outputs)) allowMediaPath(output.path);
      return {
        jobId: job.id,
        state: job.state,
        outputs,
        metadata: job.metadata,
        provenance: job.provenance,
        error: job.error,
      } satisfies DesktopGenerateResult;
    } catch (err) {
      return failedGenerate((err as Error).message);
    }
  });

  ipcMain.handle('ovm:generate-cancel', (_event, payload: { jobId?: unknown }) => {
    if (generationService && typeof payload?.jobId === 'string') return { ok: generationService.cancel(payload.jobId) };
    return { ok: false };
  });
}

interface RenderPayload {
  project: Project;
  assetPaths: Record<string, string>;
  outputPath?: string;
  options: {
    width: number;
    height: number;
    fps: { num: number; den: number };
    sampleRate: number;
    quality: 'draft' | 'balanced' | 'high';
    encoderPreference: 'auto' | 'hardware' | 'software';
  };
}

/** Shared by the IPC handler and the smoke test: plan -> ffmpeg -> job. */
async function renderProjectLocal(payload: RenderPayload, onProgress?: (progress: { state: string; progress: number }) => void): Promise<RenderJob> {
  if (!payload.outputPath) throw new Error('render requires an outputPath');
  const plan = await buildRenderPlan(
    payload.project,
    { ...payload.options, outputPath: payload.outputPath },
    (assetId) => payload.assetPaths[assetId] ?? null,
  );
  const job = new RenderJob('desktop-render');
  job.subscribe((event) => onProgress?.({ state: event.state, progress: event.progress }));
  return runRenderJob(plan, job);
}

/** Shared by the IPC handler and the smoke test: run a local generation job. */
async function runGenerationLocal(request: DesktopGenerateRequest): Promise<{ job: GenerationJob; outputs: Record<string, DesktopOutput> }> {
  if (!generationService) throw new Error('generation service unavailable');
  const job = generationService.generate(request);
  await job.finished;
  const outputs = job.state === 'completed' ? await describeJobOutputs(job) : {};
  for (const output of Object.values(job.outputs)) allowMediaPath(output.path);
  return { job, outputs };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#10141b',
    show: !process.argv.includes('--smoke'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.OVM_STUDIO_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(studioDist, 'index.html'));
  }
  return window;
}

/**
 * Headless verification: capabilities + persistence + a real render + a
 * REAL generation round trip (Kokoro TTS -> Whisper ASR on the TTS output
 * -> transcript + caption clips landed through core ops, exactly like the
 * Studio does it). Writes a JSON report and exits 0 only when all hold.
 */
async function runSmoke(): Promise<void> {
  const report: Record<string, unknown> = {};
  const dir = join(tmpdir(), 'ovm-desktop-smoke-' + Date.now());
  try {
    const session = ProjectSession.create('Desktop smoke project', { settings: { width: 1280, height: 720 } });
    session.transaction((tx) => {
      tx.createTrack({ sequenceId: Object.keys(session.project.sequences)[0] as never, trackId: tx.newTrackId(), kind: 'text', name: 'Hello' });
    });
    const store = ProjectStore.create(dir, session.projectId);
    store.save(session.project, session.exportLog());
    store.close();
    const reopened = ProjectStore.open(dir);
    const loaded = reopened.load();
    reopened.close();
    const bridge = {
      capabilities: { desktop: true, localPersistence: true, localRender: true, localGeneration: generationService !== null },
      reopenName: loaded.project.name,
      reopenTracks: Object.values(loaded.project.sequences).reduce((n, s) => n + s.tracks.length, 0),
      reopenCheckpoint: loaded.checkpoint,
    };
    const doctor = await probeDeviceGraph();

    // A real render round trip through the same code path the IPC uses.
    const mediaDir = join(dir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    const sample = join(mediaDir, 'sample.mp4');
    const made = await runTool('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-t', '1', '-y', sample,
    ], { timeoutMs: 120_000 });
    if (made.code !== 0) throw new Error('sample generation failed: ' + made.stderr);
    const renderSession = ProjectSession.create('Render smoke', { settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
    const renderSeq = Object.keys(renderSession.project.sequences)[0] as never;
    const asset = importedAsset({ kind: 'video', name: 'sample.mp4', path: sample, media: { durationUs: 1_000_000, hasVideo: true, hasAudio: true, width: 320, height: 180, fps: { num: 30, den: 1 } } });
    renderSession.transaction((tx) => {
      tx.importAsset({ asset });
      const trackId = tx.newTrackId();
      tx.createTrack({ sequenceId: renderSeq, trackId, kind: 'video', name: 'V1' });
      tx.insertClip({ sequenceId: renderSeq, trackId, clip: mediaClip({ trackId, assetId: asset.id, start: 0, duration: 1_000_000 }) });
    });
    const outPath = join(dir, 'out.mp4');
    const job = await renderProjectLocal({
      project: renderSession.project as Project,
      assetPaths: { [asset.id]: sample },
      outputPath: outPath,
      options: { width: 320, height: 180, fps: { num: 30, den: 1 }, sampleRate: 48000, quality: 'draft', encoderPreference: 'auto' },
    });
    if (job.state !== 'completed') throw new Error('render smoke failed: ' + job.error);
    const probeOut = await runTool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', outPath]);
    const durationOut = Number(JSON.parse(probeOut.stdout).format.duration);

    // Real generation through the same code path the IPC handler uses.
    if (!generationService) throw new Error('generation service unavailable');
    const genSession = ProjectSession.create('Generation smoke', { settings: { width: 1280, height: 720 } });
    const tts = await runGenerationLocal({
      capability: 'audio.tts',
      modelId: 'hf/hexgrad/Kokoro-82M',
      modelInputs: { voice: 'voices/af_heart.pt' },
      settings: { text: 'Desktop generation smoke test.' },
      device: 'cpu',
      provenanceInputs: [{ kind: 'text', role: 'script', text: 'Desktop generation smoke test.' }],
    });
    if (tts.job.state !== 'completed') throw new Error('TTS smoke failed: ' + tts.job.error);
    const ttsProvenance = tts.job.provenance;
    const ttsOutput = tts.outputs.audio;
    if (!ttsOutput?.media?.hasAudio || !ttsOutput.media.durationUs || !ttsProvenance) throw new Error('TTS output not probeable audio');
    const voiceAsset = generatedAsset({
      kind: 'audio',
      name: 'Smoke voiceover',
      source: { kind: 'file', path: ttsOutput.path },
      media: ttsOutput.media,
      capability: ttsProvenance.capability,
      model: ttsProvenance.model,
      runner: ttsProvenance.runner,
      settings: ttsProvenance.settings,
      inputs: ttsProvenance.inputs,
      regenerable: ttsProvenance.regenerable,
      device: ttsProvenance.device,
      generatedAt: ttsProvenance.generatedAt,
    });
    genSession.transaction((tx) => tx.importAsset({ asset: voiceAsset }));

    const asr = await runGenerationLocal({
      capability: 'audio.asr',
      modelId: 'hf/openai/whisper-large-v3',
      inputs: { audio: { path: ttsOutput.path } },
      settings: { language: 'en' },
      device: 'cuda',
      provenanceInputs: [{ kind: 'audio', role: 'source', assetId: voiceAsset.id }],
    });
    if (asr.job.state !== 'completed') throw new Error('ASR smoke failed: ' + asr.job.error);
    const transcriptOutput = asr.outputs.transcript;
    const parsed = transcriptOutput?.json as { language?: string; segments?: Array<{ text: string; startMs: number; endMs: number }> } | undefined;
    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) throw new Error('ASR produced no transcript segments');
    const asrProvenance = asr.job.provenance;
    if (!asrProvenance) throw new Error('ASR job has no provenance');
    const attach = attachAsrResult(genSession, {
      audioAssetId: voiceAsset.id,
      language: parsed.language,
      segments: parsed.segments,
      provenance: { ...asrProvenance, inputs: [{ kind: 'audio', role: 'source', assetId: voiceAsset.id }] },
    });
    const genSeq = Object.keys(genSession.project.sequences)[0] as never;
    const captionTrack = genSession.project.sequences[genSeq]!.tracks.find((t) => t.id === attach.trackId);
    if (!captionTrack || captionTrack.clips.length === 0) throw new Error('ASR captions missing from the timeline');
    const voiceAssetStored = genSession.project.assets[voiceAsset.id];
    if (!voiceAssetStored || voiceAssetStored.origin.kind !== 'generated') throw new Error('voice asset lost its provenance');

    report.ok = true;
    report.bridge = bridge;
    report.render = { state: job.state, outputExists: existsSync(outPath), duration: durationOut };
    report.generation = {
      tts: { state: tts.job.state, modelId: tts.job.modelId, durationUs: ttsOutput.media?.durationUs },
      asr: { state: asr.job.state, modelId: asr.job.modelId, segments: parsed.segments.length, captions: captionTrack.clips.length },
    };
    report.doctor = { platform: doctor.os.platform, gpus: doctor.gpus.length, ffmpeg: doctor.ffmpegVersion },
    mkdirSync(resolve(here, '../../../.research'), { recursive: true });
    writeFileSync(resolve(here, '../../../.research/desktop-smoke.json'), JSON.stringify(report, null, 2));
    console.log('DESKTOP SMOKE OK');
  } catch (err) {
    report.ok = false;
    report.error = (err as Error).message;
    writeFileSync(resolve(here, '../../../.research/desktop-smoke.json'), JSON.stringify(report, null, 2));
    console.error('DESKTOP SMOKE FAILED: ' + (err as Error).message);
    process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  app.quit();
}

void app.whenReady().then(async () => {
  registerIpc();
  registerMediaProtocol();
  buildGenerationService();
  if (process.argv.includes('--smoke')) {
    await runSmoke();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

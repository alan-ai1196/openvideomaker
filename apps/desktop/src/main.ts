import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachAsrResult, generatedAsset, importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import { LlmPlanner, resolveLlmConfigFromEnv } from '@openvideomaker/agent';
import { ProjectStore } from '@openvideomaker/persistence';
import { doctorRecommendations, formatDoctor, probeDeviceGraph } from '@openvideomaker/devices';
import { analyzeMedia, analyzeMediaLevel2, probeMediaPath, runTool } from '@openvideomaker/media';
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
// Packaged apps carry the Studio build + registry data + runner adapters
// in their resources (electron-builder extraResources); in development
// they resolve from the repository layout.
const resourcesRoot = app.isPackaged ? process.resourcesPath : resolve(here, '../../..');
const studioDist = app.isPackaged ? join(resourcesRoot, 'studio') : resolve(here, '../../studio/dist');
const packagedRegistryPath = join(resourcesRoot, 'registry/index.json');
const packagedRunnersDir = join(resourcesRoot, 'runners');
let currentProjectDir: string | null = null;
let generationService: DesktopGenerationService | null = null;
const activeRenders = new Map<string, RenderJob>();
const activeInstalls = new Map<string, AbortController>();
let llmPlanner: LlmPlanner | null = null;

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

/** The OpenVideoMaker-managed home: model store, runtimes, generated outputs. */
function ovmHome(): string {
  const root = process.env.OVM_ROOT ?? resourcesRoot;
  return process.env.OVM_HOME ?? (app.isPackaged ? app.getPath('userData') : join(root, '.research'));
}

/** Recently used projects (dir + display name, newest first, capped). */
interface RecentProject {
  dir: string;
  name: string;
  updatedAt: string;
}

function recentsPath(): string {
  return join(ovmHome(), 'recents.json');
}

function loadRecents(): RecentProject[] {
  try {
    const raw = JSON.parse(readFileSync(recentsPath(), 'utf8')) as unknown;
    if (Array.isArray(raw)) {
      return raw
        .filter((r): r is RecentProject => !!r && typeof (r as RecentProject).dir === 'string' && typeof (r as RecentProject).name === 'string')
        .slice(0, 10);
    }
  } catch {
    // No recents yet - an honest empty list.
  }
  return [];
}

function recordRecent(dir: string, name: string): void {
  const next = [{ dir, name, updatedAt: new Date().toISOString() }, ...loadRecents().filter((r) => r.dir !== dir)].slice(0, 10);
  try {
    writeFileSync(recentsPath(), JSON.stringify(next, null, 2));
  } catch {
    // Recents are a convenience; failures never block saving.
  }
}

/** Sum file sizes + counts under a directory (bounded to OVM dirs; 0 when missing). */
async function walkDir(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          bytes += (await stat(full)).size;
          files += 1;
        } catch {
          // File removed between listing and stat: skip.
        }
      }
    }
  }
  return { bytes, files };
}

/**
 * The local generation backend: the SAME GenerationRunner the SDK/CLI
 * use (registry + content store + uv runtimes + runner protocol), driven
 * by runner manifests. When it cannot build (missing registry/runners),
 * localGeneration stays honestly false.
 */
function buildGenerationService(): void {
  try {
    const root = process.env.OVM_ROOT ?? resourcesRoot;
    const registryPath = app.isPackaged ? packagedRegistryPath : join(root, 'packages/registry/src/data/index.json');
    const runnersDir = app.isPackaged ? packagedRunnersDir : join(root, 'runners');
    if (!existsSync(registryPath) || !existsSync(runnersDir)) {
      console.warn('desktop: generation service unavailable (registry or runners not found)');
      return;
    }
    const home = ovmHome();
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

/**
 * The LLM editing planner, configured explicitly through environment:
 * the generic OpenAI-compatible preset (OVM_LLM_ENDPOINT/OVM_LLM_MODEL,
 * optional OVM_LLM_API_KEY) or the optional OrcaRouter provider preset
 * (ORCAROUTER_API_KEY/ORCAROUTER_MODEL, official endpoint by default).
 * When unset, the desktop honestly reports llmPlanner: false and the
 * Studio keeps the deterministic planner. OrcaRouter is never mandatory
 * and never overrides an explicit generic configuration.
 */
function buildLlmPlanner(): void {
  const config = resolveLlmConfigFromEnv(process.env);
  if (!config) return;
  llmPlanner = new LlmPlanner({ endpoint: config.endpoint, model: config.model, apiKey: config.apiKey });
  console.log('desktop: LLM planner configured via ' + config.provider + ' (' + config.model + ')');
}

function registerIpc(): void {
  ipcMain.handle('ovm:capabilities', () => ({
    desktop: true,
    localPersistence: true,
    localRender: true,
    localGeneration: generationService !== null,
    llmPlanner: llmPlanner !== null,
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
    recordRecent(dir, loaded.project.name);
    for (const asset of Object.values(loaded.project.assets)) {
      if (asset.source.kind === 'file') allowMediaPath(asset.source.path);
    }
    return { project: loaded.project, log: loaded.log } satisfies { project: Project; log: ProjectLog };
  });

  ipcMain.handle('ovm:recents', () => loadRecents());

  // Open a previously used project folder directly (no dialog). The
  // folder entered the recents list through the app's own save/open
  // dialogs, so it has the same trust level as a fresh dialog choice.
  ipcMain.handle('ovm:open-project-dir', async (_event, payload: { dir?: unknown }) => {
    if (typeof payload?.dir !== 'string' || payload.dir.length === 0) return { ok: false, message: 'a project directory is required' };
    try {
      const store = ProjectStore.open(payload.dir);
      const loaded = store.load();
      store.close();
      currentProjectDir = payload.dir;
      recordRecent(payload.dir, loaded.project.name);
      for (const asset of Object.values(loaded.project.assets)) {
        if (asset.source.kind === 'file') allowMediaPath(asset.source.path);
      }
      return { ok: true, project: loaded.project, log: loaded.log, dir: payload.dir };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
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
      recordRecent(currentProjectDir, payload.project.name);
      return { ok: true, appended: saved.appended, dir: currentProjectDir };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  });

  ipcMain.handle('ovm:doctor', async () => {
    const graph = await probeDeviceGraph();
    return { graph, recommendations: doctorRecommendations(graph), report: formatDoctor(graph) };
  });

  ipcMain.handle('ovm:project-info', () => ({ dir: currentProjectDir }));

  ipcMain.handle('ovm:import-media', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Import media',
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const imported: Array<{ path: string; name: string; media: unknown; kind?: string; analysis?: unknown }> = [];
    for (const filePath of result.filePaths) {
      try {
        const probe = await probeMediaPath(filePath);
        const item: { path: string; name: string; media: unknown; kind?: string; analysis?: unknown } = {
          path: filePath,
          name: filePath.split(/[\\/]/).pop() ?? filePath,
          media: probe.media,
          kind: probe.kind,
        };
        // Media intelligence Levels 1-2: shots, keyframe points, audio
        // regions and per-shot motion derived on import (best-effort;
        // failures never block the import itself).
        try {
          if (probe.media.hasVideo) {
            item.analysis = await analyzeMediaLevel2(filePath, { durationUs: probe.media.durationUs });
          } else if (probe.media.hasAudio) {
            item.analysis = await analyzeMedia(filePath, { durationUs: probe.media.durationUs });
          }
        } catch {
          // Analysis is optional presentation data.
        }
        imported.push(item);
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
    const jobId = 'render-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const job = await renderProjectLocal({ ...payload, outputPath }, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('ovm:render-progress', { ...progress, jobId });
    }, jobId);
    activeRenders.delete(jobId);
    if (job.state === 'completed' && outputPath) allowMediaPath(outputPath);
    return { state: job.state, outputPath: job.state === 'completed' ? job.outputPath : undefined, error: job.error, jobId };
  });

  ipcMain.handle('ovm:render-cancel', (_event, payload: { jobId?: unknown }) => {
    if (typeof payload?.jobId !== 'string') return { ok: false };
    const job = activeRenders.get(payload.jobId);
    if (!job) return { ok: false };
    job.cancel();
    return { ok: true };
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

  ipcMain.handle('ovm:model-installed', () => (generationService ? generationService.installedModels() : []));

  ipcMain.handle('ovm:agent-plan', async (_event, payload) => {
    if (!llmPlanner) return { ok: false, code: 'llm.unconfigured', message: 'no LLM endpoint configured (set OVM_LLM_ENDPOINT and OVM_LLM_MODEL)' };
    const goal = payload?.goal;
    if (typeof goal !== 'string' || goal.trim().length === 0 || goal.length > 2000) {
      return { ok: false, code: 'llm.invalid-goal', message: 'a goal between 1 and 2000 characters is required' };
    }
    try {
      // Rebuild the session from the renderer's current project, so the
      // plan compiles against the SAME state the user sees.
      const session = ProjectSession.open(payload.project, payload.log);
      return await llmPlanner.plan(session, goal.trim());
    } catch (err) {
      return { ok: false, code: 'llm.failed', message: (err as Error).message };
    }
  });

  ipcMain.handle('ovm:model-install', async (event, payload) => {
    if (!generationService) return { state: 'failed', error: 'generation service unavailable on this computer' };
    const modelId = payload?.modelId;
    if (typeof modelId !== 'string' || modelId.length === 0) return { state: 'failed', error: 'invalid install request' };
    const controller = new AbortController();
    activeInstalls.set(modelId, controller);
    try {
      return await generationService.installModel(modelId, (d) => {
        if (!event.sender.isDestroyed()) event.sender.send('ovm:model-install-progress', { modelId, ...d });
      }, controller.signal);
    } catch (err) {
      return { state: 'failed', error: (err as Error).message };
    } finally {
      activeInstalls.delete(modelId);
    }
  });

  ipcMain.handle('ovm:storage', async () => {
    const home = ovmHome();
    const storeDir = join(home, 'model-store');
    const models = (generationService?.installedModels() ?? []).map((m) => {
      const manifest = generationService!.runner.store.manifest(m.modelId, m.revision);
      const bytes = manifest ? manifest.files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0) : 0;
      return { modelId: m.modelId, bytes };
    });
    const runtimes: Array<{ name: string; bytes: number }> = [];
    try {
      for (const entry of await readdir(join(home, 'runtimes'))) {
        const { bytes } = await walkDir(join(home, 'runtimes', entry));
        runtimes.push({ name: entry, bytes });
      }
    } catch {
      // No runtimes created yet - honest empty list.
    }
    const generated = await walkDir(join(home, 'generated'));
    const partials = await walkDir(join(storeDir, 'partial'));
    const totalBytes = models.reduce((sum, m) => sum + m.bytes, 0) + runtimes.reduce((sum, r) => sum + r.bytes, 0) + generated.bytes + partials.bytes;
    return { home, models, runtimes, generated, partials, totalBytes };
  });

  // Clean ONLY interrupted downloads (resumable .part files). Model
  // weights, runtimes and generated outputs stay untouched: generated
  // outputs may be referenced by saved projects.
  ipcMain.handle('ovm:storage-clean', async () => {
    const partialsDir = join(ovmHome(), 'model-store', 'partial');
    const before = await walkDir(partialsDir);
    rmSync(partialsDir, { recursive: true, force: true });
    return { removedBytes: before.bytes, removedFiles: before.files };
  });

    ipcMain.handle('ovm:model-install-cancel', (_event, payload: { modelId?: unknown }) => {
    if (typeof payload?.modelId === 'string') {
      activeInstalls.get(payload.modelId)?.abort();
      return { ok: true };
    }
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
async function renderProjectLocal(payload: RenderPayload, onProgress?: (progress: { state: string; progress: number }) => void, jobId = 'desktop-render'): Promise<RenderJob> {
  if (!payload.outputPath) throw new Error('render requires an outputPath');
  const plan = await buildRenderPlan(
    payload.project,
    { ...payload.options, outputPath: payload.outputPath },
    (assetId) => payload.assetPaths[assetId] ?? null,
  );
  const job = new RenderJob(jobId);
  activeRenders.set(jobId, job);
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
    // Dev-mode window icon; the packaged exe carries the same icon from
    // electron-builder (win.icon), so no icon option is needed there.
    ...(app.isPackaged ? {} : { icon: resolve(here, '../build/icon.png') }),
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
  buildLlmPlanner();
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

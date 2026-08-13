import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importedAsset, mediaClip, ProjectSession } from '@openvideomaker/core';
import { ProjectStore } from '@openvideomaker/persistence';
import { probeDeviceGraph } from '@openvideomaker/devices';
import { probeMediaPath, runTool } from '@openvideomaker/media';
import { buildRenderPlan, RenderJob, runRenderJob } from '@openvideomaker/render';
import type { Project, ProjectLog } from '@openvideomaker/schema';

/**
 * Desktop shell: one Electron window around the SAME Studio UI. The
 * renderer stays sandboxed (contextIsolation, no node integration) and
 * reaches local powers only through the narrow typed preload bridge.
 * Honest capabilities: persistence and device probing are real today;
 * local rendering and generation arrive with later slices and stay
 * false until then.
 */

const here = dirname(fileURLToPath(import.meta.url));
const studioDist = resolve(here, '../../studio/dist');
let currentProjectDir: string | null = null;

function registerIpc(): void {
  ipcMain.handle('ovm:capabilities', () => ({
    desktop: true,
    localPersistence: true,
    localRender: true,
    localGeneration: false,
  }));

  ipcMain.handle('ovm:open-project', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Open an OpenVideoMaker project' });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0]!;
    const store = ProjectStore.open(dir);
    const loaded = store.load();
    store.close();
    currentProjectDir = dir;
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
    return { state: job.state, outputPath: job.state === 'completed' ? job.outputPath : undefined, error: job.error };
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
 * Headless verification: capabilities + a persistence round trip.
 * Writes a JSON report and exits 0 only when everything holds.
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
      capabilities: { desktop: true, localPersistence: true, localRender: true, localGeneration: false },
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

    report.ok = true;
    report.bridge = bridge;
    report.render = { state: job.state, outputExists: existsSync(outPath), duration: durationOut };
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

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectSession } from '@openvideomaker/core';
import { ProjectStore } from '@openvideomaker/persistence';
import { probeDeviceGraph } from '@openvideomaker/devices';
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
    localRender: false,
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
      capabilities: { desktop: true, localPersistence: true, localRender: false, localGeneration: false },
      reopenName: loaded.project.name,
      reopenTracks: Object.values(loaded.project.sequences).reduce((n, s) => n + s.tracks.length, 0),
      reopenCheckpoint: loaded.checkpoint,
    };
    const doctor = await probeDeviceGraph();
    report.ok = true;
    report.bridge = bridge;
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

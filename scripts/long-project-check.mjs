import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ProjectSession, mediaClip, textClip, importedAsset } from '@openvideomaker/core';

/**
 * Long-project hardening: a REAL project with 1500 clips across three
 * tracks loads in the Studio and stays responsive because the timeline
 * virtualizes clip DOM nodes to the visible window. Runs against the
 * dev server (pnpm --filter @openvideomaker/studio dev).
 */
const session = ProjectSession.create('Long Project', { settings: { width: 1920, height: 1080 } });
const seqId = Object.keys(session.project.sequences)[0];
const videoAsset = importedAsset({ kind: 'video', name: 'clip.mp4', path: 'C:/clip.mp4', media: { durationUs: 10_000_000, hasVideo: true, hasAudio: false } });
const audioAsset = importedAsset({ kind: 'audio', name: 'audio.mp3', path: 'C:/audio.mp3', media: { durationUs: 10_000_000, hasVideo: false, hasAudio: true } });
session.transaction((tx) => {
  tx.importAsset({ asset: videoAsset });
  tx.importAsset({ asset: audioAsset });
  const video = tx.newTrackId();
  tx.createTrack({ sequenceId: seqId, trackId: video, kind: 'video', name: 'V1' });
  const audio = tx.newTrackId();
  tx.createTrack({ sequenceId: seqId, trackId: audio, kind: 'audio', name: 'A1' });
  const text = tx.newTrackId();
  tx.createTrack({ sequenceId: seqId, trackId: text, kind: 'text', name: 'T1' });
  for (let i = 0; i < 500; i += 1) {
    const start = i * 8_000_000;
    tx.insertClip({ sequenceId: seqId, trackId: video, clip: mediaClip({ trackId: video, assetId: videoAsset.id, start, duration: 4_000_000 }) });
    tx.insertClip({ sequenceId: seqId, trackId: audio, clip: mediaClip({ trackId: audio, assetId: audioAsset.id, start, duration: 4_000_000 }) });
    tx.insertClip({ sequenceId: seqId, trackId: text, clip: textClip({ trackId: text, start, duration: 4_000_000, content: 'Scene ' + (i + 1) }) });
  }
});
mkdirSync('.research', { recursive: true });
writeFileSync('.research/long-project.ovm.json', JSON.stringify({ project: session.project, log: session.exportLog() }));
console.log('fixture: 1500 clips saved');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });
const t0 = Date.now();
await page.locator('.topbar-actions input[type=file]').setInputFiles('.research/long-project.ovm.json');
await page.waitForSelector('.project-name', { timeout: 30000 });
await page.waitForTimeout(600);
const loadMs = Date.now() - t0;

const report = {};
const snapshot = await page.evaluate(() => {
  const controller = window.__ovmStudio;
  const project = controller.project;
  const total = Object.values(project.sequences).reduce((n, s) => n + s.tracks.reduce((m, t) => m + t.clips.length, 0), 0);
  return {
    name: project.name,
    totalClips: total,
    renderedClips: document.querySelectorAll('.clip').length,
    lanes: document.querySelectorAll('.lane').length,
    undoDepth: controller.canUndo,
  };
});
report.loadMs = loadMs;
report.atStart = snapshot;

// Scroll far into the timeline (state-driven wheel scrolling): the
// window moves, clips stay virtualized.
await page.locator('.timeline-body').hover();
await page.mouse.wheel(200000, 0);
await page.waitForTimeout(300);
await page.mouse.wheel(200000, 0);
await page.waitForTimeout(500);
report.renderedClipsAtEnd = await page.locator('.clip').count();
report.sceneAtEnd = await page.locator('.clip-label').last().textContent();

// Select a visible clip and check the inspector follows. The timeline
// scrolls by state (not native overflow), so interact via VIEWPORT
// mouse coordinates: pick a rendered clip whose box is on-screen.
const clipTarget = await page.evaluate(() => {
  // The viewport clips at its left edge (~168px): only clips fully inside
  // hit-test correctly, so pick one well within the visible area.
  const clips = Array.from(document.querySelectorAll('.clip'));
  const visible = clips.find((el) => {
    const r = el.getBoundingClientRect();
    return r.x >= 250 && r.x <= 1400;
  });
  if (!visible) return null;
  const r = visible.getBoundingClientRect();
  return { x: r.x + 15, y: r.y + 8 };
});
if (clipTarget) {
  await page.mouse.click(clipTarget.x, clipTarget.y);
  await page.waitForTimeout(250);
}
report.selectedVisible = (await page.locator('.clip.selected').count()) > 0;
report.inspectorActive = (await page.locator('.inspector').count()) > 0;

// Playhead seek: click an EMPTY part of the lane (no clip under the
// pointer), inside the viewport.
const laneBox = await page.locator('.lane').first().boundingBox();
if (laneBox) {
  await page.mouse.click(320, laneBox.y + 10);
  await page.waitForTimeout(250);
}
report.seeked = await page.locator('.transport-time').textContent();

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (snapshot.totalClips !== 1500) throw new Error('expected 1500 clips, got ' + snapshot.totalClips);
if (snapshot.lanes !== 3) throw new Error('expected 3 lanes, got ' + snapshot.lanes);
if (snapshot.renderedClips > 300) throw new Error('timeline not virtualized: ' + snapshot.renderedClips + ' clip DOM nodes');
if (report.renderedClipsAtEnd > 300 || report.renderedClipsAtEnd === 0) throw new Error('virtualization failed after scroll: ' + report.renderedClipsAtEnd);
if (!/Scene (4[0-9][0-9]|500)/.test(report.sceneAtEnd ?? '')) throw new Error('expected the last scenes after scrolling, got ' + report.sceneAtEnd);
if (report.selectedVisible !== true) throw new Error('clip selection failed');
if (report.seeked === '00:00:00:00') throw new Error('lane seek did not move the playhead');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('LONG PROJECT OK (load ' + loadMs + 'ms, ' + snapshot.renderedClips + ' of 1500 clips rendered)');
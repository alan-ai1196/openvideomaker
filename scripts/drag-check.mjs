import { chromium } from 'playwright';

const BASE = 'http://localhost:5183/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

async function openStudio() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.studio', { timeout: 15000 });
}

async function timelineInfo() {
  return await page.evaluate(() => {
    const c = window.__ovmStudio;
    const sequence = c.activeSequence();
    const video = sequence.tracks.find((t) => t.kind === 'video');
    const clips = video.clips;
    const last = clips[clips.length - 1];
    const prev = clips[clips.length - 2];
    return { lastId: last.id, lastStart: last.start, lastEnd: last.start + last.duration, prevId: prev.id, prevEnd: prev.start + prev.duration, zoom: c.zoomPxPerSec };
  });
}

const report = {};

// Scenario 1: a plain move still works (no snap target nearby).
await openStudio();
{
  const before = await timelineInfo();
  const clip = page.locator('.clip').nth(2); // outro
  const box = await clip.boundingBox();
  if (!box) throw new Error('clip not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 96, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await timelineInfo();
  report.basicMove = { before: before.lastStart, after: after.lastStart };
  report.basicMoved = after.lastStart > before.lastStart;
}

// Scenario 2: the moving clip's START snaps to the previous clip's END
// (proposed 0.3s past the edge) and a guide line shows during the drag.
await openStudio();
{
  const info = await timelineInfo();
  const clip = page.locator('.clip').nth(2);
  const box = await clip.boundingBox();
  if (!box) throw new Error('clip not visible');
  const delta = 300_000;
  const targetMouseX = box.x + box.width / 2 + (info.prevEnd + delta - info.lastStart) / 1_000_000 * info.zoom;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetMouseX, box.y + box.height / 2, { steps: 10 });
  await page.waitForTimeout(150);
  report.edgeSnapGuideDuringDrag = await page.locator('.snap-guide').count();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => {
    const c = window.__ovmStudio;
    const sequence = c.activeSequence();
    const video = sequence.tracks.find((t) => t.kind === 'video');
    const clip = video.clips.find((k) => k.id === id);
    return { start: clip ? clip.start : -1, error: c.lastError };
  }, info.lastId);
  report.edgeSnap = { proposed: info.prevEnd + delta, expected: info.prevEnd, actual: after.start, error: after.error };
  report.edgeSnapOk = after.start === info.prevEnd;
  report.guideAfterEdgeDrop = await page.locator('.snap-guide').count();
}

// Scenario 3: the moving clip's START snaps to the PLAYHEAD.
await openStudio();
{
  const info = await timelineInfo();
  const playhead = info.prevEnd + 2_000_000;
  await page.evaluate((us) => window.__ovmStudio.setPlayhead(us), playhead);
  const clip = page.locator('.clip').nth(2);
  const box = await clip.boundingBox();
  if (!box) throw new Error('clip not visible');
  const delta = 300_000;
  const targetMouseX = box.x + box.width / 2 + (playhead + delta - info.lastStart) / 1_000_000 * info.zoom;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetMouseX, box.y + box.height / 2, { steps: 10 });
  await page.waitForTimeout(150);
  report.playheadSnapGuideDuringDrag = await page.locator('.snap-guide').count();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => {
    const c = window.__ovmStudio;
    const sequence = c.activeSequence();
    const video = sequence.tracks.find((t) => t.kind === 'video');
    const clip = video.clips.find((k) => k.id === id);
    return { start: clip ? clip.start : -1, error: c.lastError };
  }, info.lastId);
  report.playheadSnap = { playhead, proposed: playhead + delta, actual: after.start, error: after.error };
  report.playheadSnapOk = after.start === playhead;
}

// Scenario 4: a TRIM (in edge) snaps to the previous clip's end.
await openStudio();
{
  const info = await timelineInfo();
  const clip = page.locator('.clip').nth(2);
  await clip.click();
  await page.waitForTimeout(150);
  const handle = clip.locator('.clip-handle-in');
  const hbox = await handle.boundingBox();
  if (!hbox) throw new Error('in handle not visible');
  const delta = 300_000;
  const targetMouseX = hbox.x + (info.prevEnd + delta - info.lastStart) / 1_000_000 * info.zoom;
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetMouseX, hbox.y + hbox.height / 2, { steps: 10 });
  await page.waitForTimeout(150);
  report.trimSnapGuideDuringDrag = await page.locator('.snap-guide').count();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => {
    const c = window.__ovmStudio;
    const sequence = c.activeSequence();
    const video = sequence.tracks.find((t) => t.kind === 'video');
    const clip = video.clips.find((k) => k.id === id);
    return { start: clip ? clip.start : -1, error: c.lastError };
  }, info.lastId);
  report.trimSnap = { proposed: info.prevEnd + delta, expected: info.prevEnd, actual: after.start, error: after.error };
  report.trimSnapOk = after.start === info.prevEnd;
}

console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!report.basicMoved) throw new Error('basic move no longer works: ' + JSON.stringify(report.basicMove));
if (report.edgeSnapGuideDuringDrag !== 1) throw new Error('edge snap guide missing during drag: ' + report.edgeSnapGuideDuringDrag);
if (!report.edgeSnapOk) throw new Error('edge snap failed: ' + JSON.stringify(report.edgeSnap));
if (report.guideAfterEdgeDrop !== 0) throw new Error('snap guide lingers after drop: ' + report.guideAfterEdgeDrop);
if (report.playheadSnapGuideDuringDrag !== 1) throw new Error('playhead snap guide missing during drag: ' + report.playheadSnapGuideDuringDrag);
if (!report.playheadSnapOk) throw new Error('playhead snap failed: ' + JSON.stringify(report.playheadSnap));
if (report.trimSnapGuideDuringDrag !== 1) throw new Error('trim snap guide missing during drag: ' + report.trimSnapGuideDuringDrag);
if (!report.trimSnapOk) throw new Error('trim snap failed: ' + JSON.stringify(report.trimSnap));
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5183/';
const SAMPLE = resolve('.research/samples/demo.mp4');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};

// 1. Import the sample through the real file input
await page.setInputFiles('input[accept="video/*,audio/*,image/*"]', SAMPLE);
await page.waitForTimeout(2500);
report.assetCount = await page.evaluate(() => Object.keys(window.__ovmStudio.project.assets).length);

// 2. Click the imported asset: insert edit at playhead 0 (demo intro splits/shifts)
const demoItem = page.locator('.asset-item', { hasText: 'demo.mp4' });
await demoItem.click();
await page.waitForTimeout(500);
report.clipCountAfterAdd = await page.locator('.clip').count();
report.videoTrack = await page.evaluate(() => {
  const seq = window.__ovmStudio.activeSequence();
  const video = seq.tracks.find((t) => t.kind === 'video');
  return video.clips.map((c) => ({ start: c.start, duration: c.duration, label: window.__ovmStudio.project.assets[c.assetId]?.name }));
});

// 3. Thumbnails + waveform arrive for the imported clip
await page.waitForTimeout(4000);
report.thumbnailImages = await page.locator('.clip-filmstrip img').count();
report.waveformSvg = await page.locator('.clip-waveform').count();

// 4. Split at playhead with S
await page.locator('.clip').first().click();
await page.evaluate(() => { window.__ovmStudio.setPlayhead(3_000_000); });
await page.keyboard.press('s');
await page.waitForTimeout(400);
report.clipCountAfterSplit = await page.locator('.clip').count();
report.splitSelected = await page.evaluate(() => window.__ovmStudio.selectedClipId !== null);

// 5. Ripple delete selected
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
report.clipCountAfterRipple = await page.locator('.clip').count();

// 6. Playback over the imported media
await page.evaluate(() => { window.__ovmStudio.setPlayhead(0); });
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
report.playheadAdvanced = await page.evaluate(() => window.__ovmStudio.playheadUs > 500_000);
report.videoVisible = await page.locator('.preview-video.visible').count();
report.videoTime = await page.evaluate(() => {
  const v = document.querySelector('.preview-video');
  return v ? v.currentTime : -1;
});
await page.keyboard.press('Space');

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();

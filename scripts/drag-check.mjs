import { chromium } from 'playwright';

const BASE = 'http://localhost:5183/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

// The last video-track clip (outro, 10-13s) has free space to its right.
const before = await page.evaluate(() => {
  const c = window.__ovmStudio;
  const sequence = c.activeSequence();
  const video = sequence.tracks.find((t) => t.kind === 'video');
  const last = video.clips[video.clips.length - 1];
  return { start: last.start, clipId: last.id };
});

const clips = page.locator('.clip');
const clip = clips.nth(2); // third clip in DOM = outro
const box = await clip.boundingBox();
if (!box) throw new Error('clip not visible');
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 96, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);

const after = await page.evaluate(() => {
  const c = window.__ovmStudio;
  const sequence = c.activeSequence();
  const video = sequence.tracks.find((t) => t.kind === 'video');
  const last = video.clips[video.clips.length - 1];
  return { start: last.start, error: c.lastError, canUndo: c.canUndo };
});

console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();

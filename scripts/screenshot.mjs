import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5183/';
const OUT = '.research/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });
await page.waitForTimeout(400);

// Dark theme, default state
await page.screenshot({ path: OUT + '/studio-dark.png' });

// Select the first clip
const clipCountBefore = await page.locator('.clip').count();
await page.locator('.clip').first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/studio-selected.png' });

// Inspector should show the clip editor
const inspectorHasBadge = await page.locator('.clip-kind-badge').count();

// Undo/redo buttons should be enabled after the welcome project was built
const undoDisabled = await page.locator('button[aria-label="Undo"]').isDisabled();

// Delete the selected clip via keyboard, verify count drops, then undo
await page.keyboard.press('Delete');
await page.waitForTimeout(250);
const clipCountAfter = await page.locator('.clip').count();
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
const clipCountUndone = await page.locator('.clip').count();

// Light theme
await page.evaluate(() => localStorage.setItem('ovm.theme', 'light'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/studio-light.png' });

// zh-CN language: set via localStorage won't persist (state only), click the select
await page.selectOption('.language-select', 'zh-CN');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/studio-zh.png' });

console.log(JSON.stringify({
  clipCountBefore,
  clipCountAfter,
  clipCountUndone,
  inspectorHasBadge,
  undoDisabled,
  errors,
}, null, 2));

await browser.close();

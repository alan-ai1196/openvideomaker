import { chromium } from 'playwright';

const BASE = 'http://localhost:5183/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};

// Export button opens the dialog
await page.locator('.topbar-actions .button-primary').click();
await page.waitForTimeout(300);
report.dialogVisible = await page.locator('.export-dialog').count();
report.presetCards = await page.locator('.export-preset').count();
report.presetNames = await page.locator('.export-preset-name').allTextContents();
report.qualityOptions = await page.locator('.export-quality').allTextContents();

// Select vertical preset + high quality
await page.locator('.export-preset', { hasText: 'Vertical' }).click();
await page.locator('.export-quality', { hasText: 'High' }).click();
await page.waitForTimeout(200);
report.selectedPreset = await page.locator('.export-preset.selected .export-preset-name').textContent();
report.selectedQuality = await page.locator('.export-quality.selected').textContent();

// Honest browser-mode note + command
report.noteVisible = await page.locator('.export-note').count();
report.command = await page.locator('.export-command').textContent();

// Download project file works
const downloadPromise = page.waitForEvent('download');
await page.locator('.export-actions .button-primary').click();
const download = await downloadPromise;
report.downloadName = download.suggestedFilename();

// Close the dialog
await page.locator('.export-actions .button', { hasText: 'Cancel' }).click();
await page.waitForTimeout(200);
report.dialogClosed = (await page.locator('.export-dialog').count()) === 0;

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();

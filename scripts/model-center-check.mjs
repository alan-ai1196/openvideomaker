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

// Open the AI tab (rail button with Spark icon, title 'AI')
await page.locator('.rail-button[title="AI"]').click();
await page.waitForTimeout(400);
report.cardCountAll = await page.locator('.model-card').count();
report.categoryChips = await page.locator('.model-category').allTextContents();
report.trustBadges = await page.locator('.trust-badge').allTextContents();
report.installDisabled = await page.locator('.model-card .button-primary').first().isDisabled();
report.generateDisabled = await page.locator('.model-card .button-secondary').first().isDisabled();
report.generateLabels = await page.locator('.model-card .button-secondary').allTextContents();

// Filter to Lip Sync category
await page.locator('.model-category', { hasText: 'Lip Sync' }).click();
await page.waitForTimeout(250);
report.cardCountLipSync = await page.locator('.model-card').count();
report.lipSyncNames = await page.locator('.model-card-name').allTextContents();

// Evidence line is present on every card
report.evidenceCount = await page.locator('.model-card-evidence').count();

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();

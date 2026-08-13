import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};
await page.locator('.rail-button[title="Transcript"]').click();
await page.waitForTimeout(300);
report.cards = await page.locator('.transcript-card').count();
report.segments = await page.locator('.transcript-segment').count();
report.firstText = await page.locator('.transcript-text').first().textContent();
report.chips = await page.locator('.transcript-chip').allTextContents();

const lanesBefore = await page.locator('.lane').count();
const before = await page.locator('.transport-time').textContent();
await page.locator('.transcript-time').nth(1).click();
await page.waitForTimeout(100);
const after = await page.locator('.transport-time').textContent();
report.seekBefore = before;
report.seekAfter = after;

await page.locator('.transcript-text').first().click();
await page.locator('.transcript-editor').fill('Corrected welcome line');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
report.edited = await page.locator('.transcript-text').first().textContent();

await page.locator('.transcript-card .button-secondary').first().click();
await page.waitForTimeout(300);
report.lanesAfterSync = await page.locator('.lane').count();
report.laneKinds = await page.locator('.track-header-kind').allTextContents();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

if (report.cards !== 1) throw new Error('expected one transcript card, got ' + report.cards);
if (report.segments !== 3) throw new Error('expected three segments, got ' + report.segments);
if (report.seekBefore === report.seekAfter) throw new Error('clicking a segment did not move the playhead');
if (report.edited !== 'Corrected welcome line') throw new Error('segment edit did not commit: ' + report.edited);
if (report.lanesAfterSync !== lanesBefore + 1) throw new Error('caption track was not added');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('TRANSCRIPT CHECK OK');

await browser.close();

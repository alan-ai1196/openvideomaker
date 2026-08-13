import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};
await page.locator('.rail-button[title="Script"]').click();
await page.waitForTimeout(300);
report.cards = await page.locator('.script-card').count();
report.lineTexts = await page.locator('.script-line-text').allTextContents();
report.characterValues = await page.locator('.script-line-character').first().inputValue();

// Edit the first line inline (typed operation).
await page.locator('.script-line-text').first().click();
await page.locator('.script-line-editor').fill('Hi, I am Ava - your host.');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
report.firstLineAfter = await page.locator('.script-line-text').first().textContent();

// Set an explicit start time on the first line, then seek to it.
await page.locator('.script-line-time').first().fill('3');
await page.waitForTimeout(200);
await page.locator('.script-line-seek').first().click();
await page.waitForTimeout(150);
report.timecode = await page.locator('.transport-time').textContent();

// Add a line and place the script on the timeline.
await page.locator('.script-add input').fill('Thanks for watching.');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
report.linesAfterAdd = await page.locator('.script-line').count();
const lanesBefore = await page.locator('.lane').count();
await page.locator('.script-head .button-secondary').first().click();
await page.waitForTimeout(300);
report.lanesAfter = await page.locator('.lane').count();
report.laneKinds = await page.locator('.track-header-kind').allTextContents();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

if (report.cards !== 1) throw new Error('expected one script card, got ' + report.cards);
if (report.lineTexts.length !== 3) throw new Error('expected three demo lines');
if (report.firstLineAfter !== 'Hi, I am Ava - your host.') throw new Error('inline edit failed: ' + report.firstLineAfter);
if (report.timecode !== '00:00:03:00') throw new Error('seek failed: ' + report.timecode);
if (report.linesAfterAdd !== 4) throw new Error('add line failed');
if (report.lanesAfter !== lanesBefore + 1) throw new Error('script track not placed');
if (!(report.laneKinds ?? []).includes('text')) throw new Error('no text lane');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('SCRIPT CHECK OK');
await browser.close();

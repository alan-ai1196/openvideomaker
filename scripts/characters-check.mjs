import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};
await page.locator('.rail-button[title="Avatars"]').click();
await page.waitForTimeout(300);
report.cards = await page.locator('.character-card').count();
report.names = await page.locator('.character-card .character-name').allTextContents();

// Create a second character.
await page.locator('.character-list > .button-primary').click();
await page.waitForTimeout(200);
report.cardsAfterCreate = await page.locator('.character-card').count();

// Rename it inline (typed operation).
await page.locator('.character-card .character-name').nth(1).click();
await page.locator('.character-card .inline-editor').fill('Bob');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
report.namesAfterRename = await page.locator('.character-card .character-name').allTextContents();

// Voice provider select + consent checkbox on the new character.
const secondCard = page.locator('.character-card').nth(1);
await secondCard.locator('select').selectOption({ label: 'Kokoro TTS' });
await page.waitForTimeout(150);
report.providerAfter = await secondCard.locator('select').inputValue();
await secondCard.locator('.character-consent input').uncheck();
await page.waitForTimeout(150);
report.consentAfter = await secondCard.locator('.character-consent input').isChecked();

// Performance slider (typed operation per commit).
await secondCard.locator('.character-slider input').first().fill('0.9');
await page.waitForTimeout(150);
report.sliderAfter = await secondCard.locator('.character-slider input').first().inputValue();

// Delete, then undo restores it.
await secondCard.locator('.icon-button').click();
await page.waitForTimeout(200);
report.cardsAfterDelete = await page.locator('.character-card').count();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
report.cardsAfterUndo = await page.locator('.character-card').count();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

if (report.cards !== 1) throw new Error('expected 1 demo character, got ' + report.cards);
if (report.cardsAfterCreate !== 2) throw new Error('create failed');
if (!report.namesAfterRename.includes('Bob')) throw new Error('rename failed: ' + JSON.stringify(report.namesAfterRename));
if (!report.providerAfter.includes('Kokoro')) throw new Error('provider select failed: ' + report.providerAfter);
if (report.consentAfter !== false) throw new Error('consent toggle failed');
if (report.sliderAfter !== '0.9') throw new Error('slider commit failed: ' + report.sliderAfter);
if (report.cardsAfterDelete !== 1) throw new Error('delete failed');
if (report.cardsAfterUndo !== 2) throw new Error('undo failed');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('CHARACTER CHECK OK');

await browser.close();

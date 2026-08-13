import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = {};
await page.locator('.rail-button[title="Agent"]').click();
await page.waitForTimeout(300);
report.hintVisible = await page.locator('.agent-hint').count();

const lanesBefore = await page.locator('.lane').count();
await page.locator('.agent-list > .button-primary').click();
await page.waitForTimeout(300);
report.proposals = await page.locator('.agent-card').count();
report.goals = await page.locator('.agent-goal').allTextContents();

// Preview the first proposal (tighten the intro).
await page.locator('.agent-card').first().locator('.agent-actions .button').first().click();
await page.waitForTimeout(200);
report.previewText = await page.locator('.agent-preview').first().textContent();

// Apply it; the intro clip shortens, which the next suggest detects.
await page.locator('.agent-card').first().locator('.button-primary').click();
await page.waitForTimeout(300);
report.stateAfterApply = await page.locator('.agent-card').first().locator('.agent-state').textContent();
report.applyDisabled = await page.locator('.agent-card').first().locator('.button-primary').isDisabled();

// The planner re-inspects the project: keep tightening until the
// intro clip drops below the planner's threshold (4s -> 3s -> 2s -> 1s).
for (let round = 0; round < 3; round++) {
  await page.locator('.agent-list > .button-primary').click();
  await page.waitForTimeout(200);
  const introCard = page.locator('.agent-card', { hasText: 'Make the intro faster' }).first();
  if ((await introCard.count()) === 0) break;
  const applyButton = introCard.locator('.button-primary');
  if (await applyButton.isEnabled()) {
    await applyButton.click();
    await page.waitForTimeout(200);
  }
}
await page.locator('.agent-list > .button-primary').click();
await page.waitForTimeout(300);
report.goalsAfterResuggest = await page.locator('.agent-goal').allTextContents();

// Apply the captions proposal: a caption track appears on the timeline.
const captionsCard = page.locator('.agent-card', { hasText: 'Add captions from the transcript' }).first();
await captionsCard.locator('.button-primary').click();
await page.waitForTimeout(300);
report.lanesAfterCaptions = await page.locator('.lane').count();
report.laneKinds = await page.locator('.track-header-kind').allTextContents();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

if (report.hintVisible !== 1) throw new Error('agent hint missing');
if (report.proposals !== 2) throw new Error('expected 2 proposals, got ' + report.proposals);
if (!report.goals.includes('Make the intro faster')) throw new Error('intro proposal missing');
if (!(report.previewText ?? '').includes('clip.trim')) throw new Error('preview missing operations: ' + report.previewText);
if (!(report.stateAfterApply ?? '').includes('Applied')) throw new Error('apply failed');
if (report.applyDisabled !== true) throw new Error('apply should be disabled after applying');
if (report.goalsAfterResuggest.includes('Make the intro faster')) throw new Error('planner did not re-inspect the changed project');
if (report.lanesAfterCaptions !== lanesBefore + 1) throw new Error('caption track not added');
if (!(report.laneKinds ?? []).includes('caption')) throw new Error('no caption lane');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('AGENT CHECK OK');

await browser.close();

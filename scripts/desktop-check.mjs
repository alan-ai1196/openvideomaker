import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';

const app = await electron.launch({ args: ['.'], cwd: 'apps/desktop' });
const window = await app.firstWindow();
await window.waitForSelector('.studio', { timeout: 30000 });
const errors = [];
window.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
window.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
const report = {};
report.title = await window.title();
report.projectName = await window.locator('.project-name').textContent();
report.bridgeCapabilities = await window.evaluate(() => window.ovm?.staticCapabilities ?? null);
report.lanes = await window.locator('.lane').count();
// The Export dialog must offer a real local Render button now.
await window.locator('.topbar .button-primary').click();
await window.waitForTimeout(300);
report.exportDialogVisible = await window.locator('.export-dialog').count();
report.renderButtonText = await window.locator('.export-dialog .button-primary').first().textContent();
report.localNote = await window.locator('.export-note strong').textContent();
await window.keyboard.press('Escape');
await window.waitForTimeout(500);
mkdirSync('.research/screenshots', { recursive: true });
await window.screenshot({ path: '.research/screenshots/desktop-studio.png' });
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await app.close();

if (!report.projectName) throw new Error('studio did not render');
if (report.bridgeCapabilities?.localPersistence !== true) throw new Error('desktop bridge missing');
if (report.bridgeCapabilities?.localRender !== true) throw new Error('localRender not flipped');
if (report.lanes < 2) throw new Error('timeline missing');
if (report.exportDialogVisible !== 1) throw new Error('export dialog missing');
if (!(report.renderButtonText ?? '').includes('Render')) throw new Error('render button missing: ' + report.renderButtonText);
if (!(report.localNote ?? '').includes('FFmpeg')) throw new Error('local render note missing: ' + report.localNote);
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('DESKTOP WINDOW OK');

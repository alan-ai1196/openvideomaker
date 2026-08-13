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
await window.waitForTimeout(500);
mkdirSync('.research/screenshots', { recursive: true });
await window.screenshot({ path: '.research/screenshots/desktop-studio.png' });
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await app.close();

if (!report.projectName) throw new Error('studio did not render');
if (report.bridgeCapabilities?.localPersistence !== true) throw new Error('desktop bridge missing');
if (report.lanes < 2) throw new Error('timeline missing');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('DESKTOP WINDOW OK');

import { _electron as electron } from 'playwright';
import { existsSync } from 'node:fs';

/**
 * The DISTRIBUTABLE app must open the real Studio UI from its bundled
 * resources (not just pass the headless smoke). Launch the packaged
 * executable and verify the window, the bridge and zero page errors.
 */
const exe = 'apps/desktop/release/win-unpacked/OpenVideoMaker.exe';
if (!existsSync(exe)) throw new Error('packaged app missing - run pnpm desktop:package first');
const app = await electron.launch({ executablePath: exe, env: { ...process.env, OVM_HOME: '.research' } });
const window = await app.firstWindow();
await window.waitForSelector('.studio', { timeout: 30000 });
const errors = [];
window.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
window.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
const report = {};
report.title = await window.title();
report.projectName = await window.locator('.project-name').textContent();
report.bridge = await window.evaluate(() => window.ovm?.staticCapabilities ?? null);
report.runtime = await window.evaluate(() => window.ovm?.capabilities() ?? null);
report.installed = await window.evaluate(() => window.ovm?.installedModels() ?? null);
report.lanes = await window.locator('.lane').count();
await window.waitForTimeout(800);
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await app.close();
if (!report.projectName) throw new Error('studio did not render');
if (report.bridge?.localGeneration !== true) throw new Error('bridge missing: ' + JSON.stringify(report.bridge));
if (report.runtime?.localGeneration !== true) throw new Error('runtime capabilities wrong: ' + JSON.stringify(report.runtime));
if (!Array.isArray(report.installed) || report.installed.length < 4) throw new Error('installed models not reported: ' + JSON.stringify(report.installed));
if (report.lanes < 2) throw new Error('timeline missing');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('PACKAGED APP OK');
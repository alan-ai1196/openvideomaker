import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// A real local media file so the desktop import flow can run against it
// (the native dialog is stubbed to return this path).
mkdirSync('.research', { recursive: true });
const sampleWav = resolve('.research/desktop-check-sample.wav');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-ar', '16000', '-ac', '1', sampleWav,
], { stdio: 'inherit' });

const app = await electron.launch({ args: ['.'], cwd: 'apps/desktop' });
// Stub the native open dialog: media import returns our sample wav.
await app.evaluate(({ dialog }, filePath) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
}, sampleWav);
const window = await app.firstWindow();
await window.waitForSelector('.studio', { timeout: 30000 });
const errors = [];
window.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
window.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
const report = {};
report.title = await window.title();
report.projectName = await window.locator('.project-name').textContent();
report.bridgeCapabilities = await window.evaluate(() => window.ovm?.staticCapabilities ?? null);
report.runtimeCapabilities = await window.evaluate(() => window.ovm?.capabilities() ?? null);
report.generationModels = await window.evaluate(() => window.ovm?.generationCapabilities() ?? null);
report.lanes = await window.locator('.lane').count();

// The Export dialog must offer a real local Render button.
await window.locator('.topbar .button-primary').click();
await window.waitForTimeout(300);
report.exportDialogVisible = await window.locator('.export-dialog').count();
report.renderButtonText = await window.locator('.export-dialog .button-primary').first().textContent();
report.localNote = await window.locator('.export-note strong').textContent();
// The dialog closes through its Cancel action (no Escape handler yet).
await window.locator('.export-actions .button').first().click();
await window.waitForTimeout(500);

// Character Studio: the demo character (Kokoro voice) offers a REAL
// voiceover generate affordance in the desktop app.
await window.locator('.rail-button[title="Avatars"]').click();
await window.waitForTimeout(300);
report.characterGenerateEnabled = !(await window.locator('.character-generate .button-secondary').first().isDisabled());
report.characterGenerateLabel = await window.locator('.character-generate .button-secondary').first().textContent();
report.characterLinePlaceholder = await window.locator('.character-generate-line').first().getAttribute('placeholder');
// REAL end-to-end: click Generate voiceover; the desktop backend runs a
// Kokoro TTS job, and the result lands on the timeline as an editable
// asset through the typed operation layer.
await window.locator('.character-generate-line').first().fill('Hello from the desktop check.');
await window.locator('.character-generate .button-secondary').first().click();
await window.waitForSelector('.character-generate-done', { timeout: 180000 });
report.voiceoverDone = await window.locator('.character-generate-done').first().textContent();
await window.locator('.rail-button[title="Media"]').click();
await window.waitForTimeout(400);
report.assetCountAfterVoiceover = await window.locator('.asset-item').count();
report.voiceoverAssetNames = await window.locator('.asset-name').allTextContents();

// Model Center: the locally runnable TTS model's Generate button is live.
await window.locator('.rail-button[title="AI"]').click();
await window.waitForTimeout(300);
const kokoroCard = window.locator('.model-card', { hasText: 'Kokoro TTS' });
report.kokoroGenerateEnabled = !(await kokoroCard.locator('.button-secondary').isDisabled());
report.kokoroGenerateLabel = await kokoroCard.locator('.button-secondary').textContent();

// Transcript panel: after importing real media, a transcribe affordance
// appears for the media without a transcript (enabled in desktop mode).
await window.locator('.rail-button[title="Media"]').click();
await window.waitForTimeout(200);
await window.locator('.leftpanel-content .button-primary').click();
await window.waitForTimeout(1200);
report.assetCountAfterImport = await window.locator('.asset-item').count();
// Place the imported wav at the playhead and verify the preview plays it
// through the ovm-media:// protocol (real bytes to a media element).
await window.locator('.asset-item').last().click();
await window.waitForTimeout(1200);
report.previewAudioSrc = await window.evaluate(() => document.querySelector('.preview audio')?.src ?? null);
report.previewAudioState = await window.evaluate(() => {
  const el = document.querySelector('.preview audio');
  return el ? { readyState: el.readyState, duration: el.duration, error: el.error ? el.error.message : null } : null;
});
await window.locator('.rail-button[title="Transcript"]').click();
await window.waitForTimeout(300);
report.transcribeRows = await window.locator('.transcribe-row').count();
report.transcribeEnabled = report.transcribeRows > 0 ? !(await window.locator('.transcribe-row .button-secondary').first().isDisabled()) : null;
report.transcribeLabel = report.transcribeRows > 0 ? await window.locator('.transcribe-row .button-secondary').first().textContent() : null;

mkdirSync('.research/screenshots', { recursive: true });
await window.screenshot({ path: '.research/screenshots/desktop-studio.png' });
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await app.close();

if (!report.projectName) throw new Error('studio did not render');
if (report.bridgeCapabilities?.localPersistence !== true) throw new Error('desktop bridge missing');
if (report.bridgeCapabilities?.localRender !== true) throw new Error('localRender not flipped');
if (report.bridgeCapabilities?.localGeneration !== true) throw new Error('localGeneration not flipped');
if (report.runtimeCapabilities?.localGeneration !== true) throw new Error('runtime capabilities do not confirm local generation');
if (!Array.isArray(report.generationModels?.models) || report.generationModels.models.length < 2) throw new Error('generation capabilities missing: ' + JSON.stringify(report.generationModels));
if (report.lanes < 2) throw new Error('timeline missing');
if (report.exportDialogVisible !== 1) throw new Error('export dialog missing');
if (!(report.renderButtonText ?? '').includes('Render')) throw new Error('render button missing: ' + report.renderButtonText);
if (!(report.localNote ?? '').includes('FFmpeg')) throw new Error('local render note missing: ' + report.localNote);
if (report.characterGenerateEnabled !== true) throw new Error('character generate affordance not live');
if (!(report.characterGenerateLabel ?? '').includes('Generate')) throw new Error('character generate label missing: ' + report.characterGenerateLabel);
if (report.kokoroGenerateEnabled !== true) throw new Error('kokoro generate affordance not live');
if (!(report.voiceoverDone ?? '').includes('timeline')) throw new Error('voiceover generation did not complete: ' + report.voiceoverDone);
if (report.assetCountAfterVoiceover !== 5) throw new Error('voiceover asset missing from the media panel: ' + report.assetCountAfterVoiceover);
if (report.assetCountAfterImport !== 6) throw new Error('desktop media import failed: ' + report.assetCountAfterImport);
if (!(report.previewAudioSrc ?? '').startsWith('ovm-media://')) throw new Error('preview audio does not stream through ovm-media: ' + report.previewAudioSrc);
if ((report.previewAudioState?.readyState ?? 0) < 1) throw new Error('preview audio did not load metadata: ' + JSON.stringify(report.previewAudioState));
if (!((report.previewAudioState?.duration ?? 0) > 0)) throw new Error('preview audio has no duration: ' + JSON.stringify(report.previewAudioState));
if (report.transcribeRows !== 2) throw new Error('expected two transcribe rows (imported wav + generated voiceover), got ' + report.transcribeRows);
if (report.transcribeEnabled !== true) throw new Error('transcribe affordance not live');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('DESKTOP WINDOW OK');

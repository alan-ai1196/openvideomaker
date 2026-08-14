import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
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

// Redub: a real local VIDEO for the lip-sync affordance. The opt-in full
// click-through (OVM_CHECK_LIPSYNC=1) needs a face, so it uses a trimmed
// upstream demo clip when the research clone is present.
const lipSyncVideo = resolve('.research/desktop-check-video.mp4');
// Three distinct scenes so media intelligence (shot detection on import)
// produces visible shot markers.
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1.5',
  '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1.5',
  '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1.5',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[outv]',
  '-map', '[outv]', '-c:v', 'libx264', '-r', '25', lipSyncVideo,
], { stdio: 'inherit' });
const upstreamDemo = resolve('.research/upstream/latentsync/assets/demo1_video.mp4');
const fullLipSync = process.env.OVM_CHECK_LIPSYNC === '1' && existsSync(upstreamDemo);
if (fullLipSync) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', upstreamDemo, '-t', '5', '-r', '25', '-c:v', 'libx264', '-an', lipSyncVideo,
  ], { stdio: 'inherit' });
}

// Opt-in LLM planner verification: a scripted OpenAI-compatible endpoint
// running on 127.0.0.1, handed to the desktop app through the documented
// environment configuration. The real wire path (IPC -> planner -> HTTP ->
// validated EditScript) runs; only the model is scripted.
const fullLlm = process.env.OVM_CHECK_LLM === '1';
let llmServer = null;
let launchEnv = undefined;
if (fullLlm) {
  llmServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      const body = JSON.parse(raw);
      const userText = (body.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join(' ');
      const match = /"(seq_[a-z0-9]+)"/.exec(userText);
      const sequenceId = match ? match[1] : 'seq_missing';
      const content = {
        schemaVersion: 1,
        goal: 'AI captions from the transcript',
        steps: [{ op: 'track.create', sequenceId, kind: 'caption', name: 'Captions', as: '$captions' }],
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });
  await new Promise((resolvePromise) => llmServer.listen(0, '127.0.0.1', resolvePromise));
  const llmPort = llmServer.address().port;
  launchEnv = {
    ...process.env,
    OVM_LLM_ENDPOINT: 'http://127.0.0.1:' + llmPort + '/v1/chat/completions',
    OVM_LLM_MODEL: 'mock-planner',
  };
}

const app = await electron.launch({ args: ['.'], cwd: 'apps/desktop', env: launchEnv ?? process.env });
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
// Job Center: the finished generation is visible with its state.
await window.locator('.rail-button[title="Jobs"]').click();
await window.waitForTimeout(400);
report.jobCardsAfterVoiceover = await window.locator('.job-card').count();
report.jobLabelAfterVoiceover = await window.locator('.job-card .job-label').first().textContent();
report.jobStateAfterVoiceover = await window.locator('.job-card .job-state').first().textContent();
report.jobKindAfterVoiceover = await window.locator('.job-card .job-kind').first().textContent();
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
// Model install: the locally installed model reads 'Installed' and the
// bridge reports the store's manifest-pinned set.
report.kokoroInstallLabel = await kokoroCard.locator('.button-primary').textContent();
report.installedModelsBridge = await window.evaluate(() => window.ovm?.installedModels() ?? null);
const whisperCard = window.locator('.model-card', { hasText: 'Whisper' });
report.whisperInstallLabel = await whisperCard.locator('.button-primary').textContent();

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

// Script-first editing: generate REAL speech for Ava's first line; the
// audio lands at the line's planned position and the line gains a real
// start time, so text and speech share one timing plan.
await window.locator('.rail-button[title="Script"]').click();
await window.waitForTimeout(300);
report.scriptSpeechEnabled = !(await window.locator('.script-line-speech').first().isDisabled());
await window.locator('.script-line-speech').first().click();
await window.waitForFunction(() => document.querySelector('.script-line-speech')?.textContent?.includes('✓'), null, { timeout: 180000 });
report.scriptSpeechAfter = await window.locator('.script-line-speech').first().textContent();
report.scriptLineStartAfter = await window.locator('.script-line-time').first().inputValue();
await window.locator('.rail-button[title="Media"]').click();
await window.waitForTimeout(300);
report.assetCountAfterScriptSpeech = await window.locator('.asset-item').count();

// Redub: import a real video, place it, select the clip, and verify the
// lip-sync affordance is live in the desktop app.
await app.evaluate(({ dialog }, filePath) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
}, lipSyncVideo);
await window.locator('.leftpanel-content .button-primary').click();
await window.waitForTimeout(1200);
report.assetCountAfterVideoImport = await window.locator('.asset-item').count();
await window.locator('.asset-item').last().click();
await window.waitForTimeout(400);
// The imported video lands at the playhead (position 0) as an insert edit,
// so it is the FIRST media clip in timeline order.
await window.locator('.clip-kind-media').first().click();
await window.waitForTimeout(300);
report.redubSectionVisible = await window.locator('.inspector-ai').count();
// Media intelligence: the imported 3-scene video shows shot markers on
// the clip and a clickable shot list in the inspector.
report.shotMarks = await window.locator('.clip-kind-media .clip-shot-mark').count();
report.shotItems = await window.locator('.shot-item').count();
if (report.shotItems > 0) {
  await window.locator('.shot-item').nth(1).click();
  await window.waitForTimeout(200);
}
report.timeAfterShotSeek = await window.locator('.transport-time').textContent();
report.redubAudioOptions = await window.locator('.inspector-redub-audio option').allTextContents();
await window.locator('.inspector-redub-audio').selectOption({ index: 1 });
await window.waitForTimeout(150);
report.redubButtonEnabled = !(await window.locator('.inspector-redub .button-secondary').isDisabled());
report.redubButtonLabel = await window.locator('.inspector-redub .button-secondary').textContent();
if (fullLipSync) {
  // Opt-in REAL lip-sync through the UI (several minutes on GPU). The
  // Job Center must show it running (progress + cancel) and then completed.
  const lanesBefore = await window.locator('.lane').count();
  await window.locator('.inspector-redub .button-secondary').click();
  await window.waitForTimeout(1500);
  await window.locator('.rail-button[title="Jobs"]').click();
  await window.waitForTimeout(400);
  report.jobRunningVisible = (await window.locator('.job-card.job-running, .job-card.job-preparing').count()) > 0;
  report.jobProgressVisible = (await window.locator('.job-card .job-progress-bar').count()) > 0;
  report.jobCancelVisible = (await window.locator('.job-card .button-secondary').count()) > 0;
  // Wait for THIS job to complete (earlier completed jobs exist).
  await window.waitForSelector('.job-card.job-completed:has-text("Lip sync")', { timeout: 900000 });
  report.lipSyncDone = 'completed in the Job Center';
  // The placement transaction lands moments after the job completes; poll
  // instead of throwing so the report always prints diagnostics.
  const laneDeadline = Date.now() + 30000;
  let lanesNow = await window.locator('.lane').count();
  while (lanesNow === lanesBefore && Date.now() < laneDeadline) {
    await window.waitForTimeout(1000);
    lanesNow = await window.locator('.lane').count();
  }
  report.lanesAfterLipSync = lanesNow;
  report.lipSyncAddedLane = lanesNow - lanesBefore;
  report.lipSyncToast = (await window.locator('.toast').count()) > 0 ? await window.locator('.toast').textContent() : null;
} else {
  report.lipSyncDone = 'skipped (OVM_CHECK_LIPSYNC=1 to run the full GPU job)';
}

// Agent panel: the LLM planner is only advertised when configured. The
// deterministic planner stays the honest default otherwise.
await window.locator('.rail-button[title="Agent"]').click();
await window.waitForTimeout(300);
report.llmPlannerAdvertised = (report.runtimeCapabilities ?? {}).llmPlanner === true;
report.agentAiVisible = await window.locator('.agent-ai').count();
if (fullLlm) {
  await window.locator('.agent-goal-input').fill('Create a caption track from the transcript');
  await window.locator('.agent-ai .button-primary').click();
  await window.waitForSelector('.agent-card', { timeout: 60000 });
  report.llmProposalGoal = await window.locator('.agent-goal').first().textContent();
  report.llmApplyEnabled = !(await window.locator('.agent-card .button-primary').first().isDisabled());
  await window.locator('.agent-card .button-primary').first().click();
  await window.waitForTimeout(500);
  report.llmAppliedState = await window.locator('.agent-state').first().textContent();
  report.lanesAfterLlm = await window.locator('.lane').count();
}

// Device Center: the probed device graph rendered friendly-first.
await window.locator('.rail-button[title="Devices"]').click();
await window.waitForTimeout(400);
report.deviceHeadline = await window.locator('.device-headline').textContent();
report.deviceCards = await window.locator('.device-card').count();
report.deviceGpuRows = await window.locator('.device-row', { hasText: '3090' }).count();
report.deviceFfmpegRow = await window.locator('.device-row', { hasText: 'ffmpeg' }).first().textContent();
report.deviceRecommendations = await window.locator('.device-notes li').count();
report.deviceRawAvailable = await window.locator('.device-report').count();
// Developer section: saving the project unlocks the MCP command.
report.mcpUnsavedHint = await window.locator('.device-mcp-hint').count();
const savedDir = resolve('.research/desktop-check-project-' + Date.now());
await app.evaluate(({ dialog }, dir) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: dir });
}, savedDir);
await window.locator('.topbar .icon-button[title="Save project file"]').first().click();
await window.waitForTimeout(2500);
report.mcpCommand = (await window.locator('.device-mcp-command').count()) > 0 ? await window.locator('.device-mcp-command').textContent() : null;
report.saveToast = (await window.locator('.toast').count()) > 0 ? await window.locator('.toast').textContent() : null;
report.saveMcpHintStill = (await window.locator('.device-mcp-hint').count()) > 0 ? await window.locator('.device-mcp-hint').first().textContent() : null;

mkdirSync('.research/screenshots', { recursive: true });
await window.screenshot({ path: '.research/screenshots/desktop-studio.png' });
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await app.close();
if (llmServer) await new Promise((resolvePromise) => llmServer.close(resolvePromise));

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
if ((report.kokoroInstallLabel ?? '').trim() !== 'Installed') throw new Error('kokoro install state wrong: ' + report.kokoroInstallLabel);
if ((report.whisperInstallLabel ?? '').trim() !== 'Installed') throw new Error('whisper install state wrong: ' + report.whisperInstallLabel);
const installedIds = (report.installedModelsBridge ?? []).map((m) => m.modelId);
if (!installedIds.includes('hf/hexgrad/Kokoro-82M') || !installedIds.includes('hf/openai/whisper-large-v3')) {
  throw new Error('installed models missing from the bridge: ' + JSON.stringify(installedIds));
}
if (!(report.voiceoverDone ?? '').includes('timeline')) throw new Error('voiceover generation did not complete: ' + report.voiceoverDone);
if (report.assetCountAfterVoiceover !== 5) throw new Error('voiceover asset missing from the media panel: ' + report.assetCountAfterVoiceover);
if (report.assetCountAfterImport !== 6) throw new Error('desktop media import failed: ' + report.assetCountAfterImport);
if (!(report.previewAudioSrc ?? '').startsWith('ovm-media://')) throw new Error('preview audio does not stream through ovm-media: ' + report.previewAudioSrc);
if ((report.previewAudioState?.readyState ?? 0) < 1) throw new Error('preview audio did not load metadata: ' + JSON.stringify(report.previewAudioState));
if (!((report.previewAudioState?.duration ?? 0) > 0)) throw new Error('preview audio has no duration: ' + JSON.stringify(report.previewAudioState));
if (report.transcribeRows !== 2) throw new Error('expected two transcribe rows (imported wav + generated voiceover), got ' + report.transcribeRows);
if (report.scriptSpeechEnabled !== true) throw new Error('script speech affordance not live');
if (!(report.scriptSpeechAfter ?? '').includes('✓')) throw new Error('script speech did not complete: ' + report.scriptSpeechAfter);
if (!(report.scriptLineStartAfter ?? '')) throw new Error('line did not gain a real start time');
if (report.assetCountAfterScriptSpeech !== 7) throw new Error('script speech asset missing from the media panel: ' + report.assetCountAfterScriptSpeech);
if (report.assetCountAfterVideoImport !== 8) throw new Error('video import failed: ' + report.assetCountAfterVideoImport);
if (report.redubSectionVisible !== 1) throw new Error('redub section missing from the inspector');
if (report.shotMarks < 2) throw new Error('shot markers missing from the clip: ' + report.shotMarks);
if (report.shotItems < 3) throw new Error('shot list missing from the inspector: ' + report.shotItems);
if (report.timeAfterShotSeek === '00:00:00:00') throw new Error('shot click did not seek the playhead');
if (!(report.redubAudioOptions ?? []).some((o) => o.includes('voiceover'))) throw new Error('voiceover missing from redub audio options: ' + JSON.stringify(report.redubAudioOptions));
if (report.redubButtonEnabled !== true) throw new Error('lip sync button not live');
if (!(report.redubButtonLabel ?? '').includes('Lip sync')) throw new Error('lip sync label missing: ' + report.redubButtonLabel);
if (report.jobCardsAfterVoiceover !== 1) throw new Error('voiceover job missing from the Job Center: ' + report.jobCardsAfterVoiceover);
if (!(report.jobLabelAfterVoiceover ?? '').includes('voiceover')) throw new Error('job label missing: ' + report.jobLabelAfterVoiceover);
if (report.jobStateAfterVoiceover !== 'Completed') throw new Error('job state wrong: ' + report.jobStateAfterVoiceover);
if (report.jobKindAfterVoiceover !== 'AI') throw new Error('job kind wrong: ' + report.jobKindAfterVoiceover);
if (fullLipSync) {
  if (!(report.lipSyncDone ?? '').includes('Job Center')) throw new Error('real lip-sync did not complete: ' + report.lipSyncDone);
  if (report.jobRunningVisible !== true) throw new Error('running lip-sync job not visible in the Job Center');
  if (report.jobProgressVisible !== true) throw new Error('job progress bar missing');
  if (report.jobCancelVisible !== true) throw new Error('job cancel button missing');
  if (report.lipSyncAddedLane !== 1) throw new Error('lip-sync track missing: ' + report.lipSyncAddedLane);
}
if (fullLlm) {
  if (report.llmPlannerAdvertised !== true) throw new Error('llm planner not advertised when configured');
  if (report.agentAiVisible !== 1) throw new Error('agent AI plan section missing');
  if (!(report.llmProposalGoal ?? '').includes('Create a caption track')) throw new Error('LLM proposal missing: ' + report.llmProposalGoal);
  if (report.llmApplyEnabled !== true) throw new Error('LLM proposal not applyable');
  if (!(report.llmAppliedState ?? '').includes('Applied')) throw new Error('LLM proposal did not apply: ' + report.llmAppliedState);
} else {
  if (report.llmPlannerAdvertised !== false) throw new Error('llm planner must not be advertised without configuration');
  if (report.agentAiVisible !== 0) throw new Error('agent AI plan section must be hidden without configuration');
}
if (!(report.deviceHeadline ?? '').includes('local AI')) throw new Error('device headline missing: ' + report.deviceHeadline);
if (report.deviceCards < 3) throw new Error('device cards missing: ' + report.deviceCards);
if (report.deviceGpuRows < 1) throw new Error('GPU row missing from the Device Center');
if (!(report.deviceFfmpegRow ?? '').includes('8')) throw new Error('ffmpeg row missing: ' + report.deviceFfmpegRow);
if (report.deviceRecommendations < 1) throw new Error('device recommendations missing');
if (report.deviceRawAvailable !== 1) throw new Error('raw report missing');
if (!(report.mcpCommand ?? '').includes('ovm mcp --project')) throw new Error('MCP command missing: ' + report.mcpCommand);
if (!(report.mcpCommand ?? '').includes('desktop-check-project')) throw new Error('MCP command lacks the project dir: ' + report.mcpCommand);
if (report.transcribeEnabled !== true) throw new Error('transcribe affordance not live');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('DESKTOP WINDOW OK');

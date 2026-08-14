import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A real local media file so the desktop import flow can run against it
// (the native dialog is stubbed to return this path).
mkdirSync('.research', { recursive: true });
// A fake interrupted model download so the storage clean action in the
// Device Center has something real to remove (dev mode uses .research
// as the OVM home, the same store the desktop app manages).
mkdirSync('.research/model-store/partial/fake-model', { recursive: true });
writeFileSync('.research/model-store/partial/fake-model/weights.part', Buffer.alloc(4096));
const sampleWav = resolve('.research/desktop-check-sample.wav');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-ar', '16000', '-ac', '1', sampleWav,
], { stdio: 'inherit' });

// Background removal: a still image with a clear subject on a plain
// background (the cutout affordance targets image clips).
const sampleImage = resolve('.research/desktop-check-image.png');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=white:s=480x360',
  '-vf', 'drawbox=x=120:y=60:w=240:h=240:color=darkred@1:t=fill',
  '-frames:v', '1', sampleImage,
], { stdio: 'inherit' });

// Redub: a real local VIDEO for the lip-sync affordance. The opt-in full
// click-through (OVM_CHECK_LIPSYNC=1) needs a face, so it uses a trimmed
// upstream demo clip when the research clone is present.
const lipSyncVideo = resolve('.research/desktop-check-video.mp4');
// Three distinct scenes with a tone track that carries two silence gaps
// (0.4s each, strictly inside scenes 1 and 2), so media intelligence
// produces shot markers AND removable silence regions.
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1.5',
  '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1.5',
  '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1.5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.7',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100:duration=0.4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.1',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100:duration=0.4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.5',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[outv];[3:a][4:a][5:a][6:a][7:a][8:a]concat=n=6:v=0:a=1[outa]',
  '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-c:a', 'aac', '-r', '25', '-shortest', lipSyncVideo,
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

// Transcript search + keyword topics (media intelligence Level 3,
// lexical): search what was said and jump straight to the line; the
// demo transcript's segments are frequency-keyworded into chips.
await window.locator('.rail-button[title="Transcript"]').click();
await window.waitForTimeout(300);
report.transcriptSearchPresent = await window.locator('.transcript-search').count();
report.transcriptKeywordChips = await window.locator('.transcript-keyword').count();
await window.locator('.transcript-search').fill('videos');
await window.waitForTimeout(300);
report.transcriptHitCount = await window.locator('.transcript-hit').count();
if (report.transcriptHitCount > 0) {
  await window.locator('.transcript-hit').first().click();
  await window.waitForTimeout(200);
}
report.timeAfterSearchSeek = await window.locator('.transport-time').textContent();
// Put the playhead back at 0 so the later video import lands first on
// the timeline (the check relies on that order).
await window.locator('.transcript-time').first().click();
await window.waitForTimeout(200);
report.timeAfterSearchReset = await window.locator('.transport-time').textContent();
await window.locator('.rail-button[title="Media"]').click();
await window.waitForTimeout(300);

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
// Shot-based editing: silence removal (ripple-closed) and splitting at
// shot boundaries are real, undoable timeline edits. The opt-in full
// lip-sync fixture has no audio, so the silence affordance is skipped.
const silenceActions = await window.locator('.shot-action', { hasText: 'silences' }).count();
if (silenceActions > 0) {
  report.removeSilenceLabel = await window.locator('.shot-action', { hasText: 'silences' }).textContent();
  report.splitAtShotsLabel = await window.locator('.shot-action', { hasText: 'Split' }).textContent();
  report.mediaClipsBeforeActions = await window.locator('.clip-kind-media').count();
  await window.locator('.shot-action', { hasText: 'silences' }).click();
  await window.waitForTimeout(500);
  report.mediaClipsAfterRemoveSilence = await window.locator('.clip-kind-media').count();
  // The middle remaining piece covers source 1.1s-2.6s, which contains
  // the 1.5s shot boundary strictly inside.
  await window.locator('.clip-kind-media').nth(1).click();
  await window.waitForTimeout(300);
  await window.locator('.shot-action', { hasText: 'Split' }).click();
  await window.waitForTimeout(500);
  report.mediaClipsAfterSplit = await window.locator('.clip-kind-media').count();
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(400);
  report.mediaClipsAfterUndo = await window.locator('.clip-kind-media').count();
} else {
  report.shotEditingSkipped = 'no audio in fixture';
}
await window.locator('.clip-kind-media').first().click();
await window.waitForTimeout(300);
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

// Background removal: a still image imports as an 'image' asset (the
// probe kind flows through the bridge), places on the timeline, and is
// the only clip that offers the cutout affordance. The opt-in
// OVM_CHECK_RMBG=1 click-through runs the REAL job through the UI
// (installing the model first if the desktop store lacks it).
await window.locator('.rail-button[title="Media"]').click();
await window.waitForTimeout(300);
await app.evaluate(({ dialog }, filePath) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
}, sampleImage);
await window.locator('.leftpanel-content .button-primary').click();
await window.waitForTimeout(1200);
report.assetCountAfterImageImport = await window.locator('.asset-item').count();
await window.locator('.asset-item').last().click();
await window.waitForTimeout(800);
const mediaClipTotal = await window.locator('.clip-kind-media').count();
let cutoutIndex = -1;
for (let i = 0; i < mediaClipTotal; i += 1) {
  await window.locator('.clip-kind-media').nth(i).click();
  await window.waitForTimeout(120);
  if ((await window.locator('.inspector-cutout').count()) > 0) {
    cutoutIndex = i;
    break;
  }
}
report.cutoutClipIndex = cutoutIndex;
// The still itself previews as an image (not a video element): stills
// are first-class preview media now.
report.stillPreviewVisible = await window.locator('.preview-image.visible').count();
if (cutoutIndex >= 0) {
  report.cutoutButtonEnabled = !(await window.locator('.inspector-cutout .button-secondary').isDisabled());
  report.cutoutButtonLabel = await window.locator('.inspector-cutout .button-secondary').textContent();
  if (process.env.OVM_CHECK_RMBG === '1') {
    const lanesBeforeCutout = await window.locator('.lane').count();
    await window.locator('.inspector-cutout .button-secondary').click();
    await window.waitForSelector('.inspector-cutout .inspector-ai-done', { timeout: 900000 });
    report.cutoutDone = 'completed in the Inspector';
    await window.locator('.rail-button[title="Jobs"]').click();
    await window.waitForTimeout(400);
    await window.waitForSelector('.job-card.job-completed:has-text("Background removal")', { timeout: 30000 });
    report.cutoutJobVisible = 'completed in the Job Center';
    await window.locator('.rail-button[title="Media"]').click();
    await window.waitForTimeout(300);
    report.assetCountAfterCutout = await window.locator('.asset-item').count();
    report.lanesAfterCutout = await window.locator('.lane').count();
    report.cutoutAddedLane = (report.lanesAfterCutout ?? 0) - lanesBeforeCutout;
  }
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

// Short creation: the deterministic planner turns the selected clip's
// Level-1/2 analysis (shots/speech/motion) into a highlight proposal
// through the same preview/apply pipeline as any agent edit. The source
// timeline stays untouched; the short lands on its own track.
// (The cutout loop left the still selected - the still has no analysis,
// so the affordance is honestly hidden there; select the analyzed video.)
await window.locator('.clip-kind-media').first().click();
await window.waitForTimeout(250);
report.shortButtonPresent = await window.locator('.agent-short').count();
report.shortButtonEnabled = report.shortButtonPresent > 0 ? !(await window.locator('.agent-short .button-primary').isDisabled()) : null;
if (report.shortButtonEnabled) {
  const lanesBeforeShort = await window.locator('.lane').count();
  const clipsBeforeShort = await window.locator('.clip-kind-media').count();
  await window.locator('.agent-short .button-primary').click();
  await window.waitForSelector('.agent-card:has-text("short")', { timeout: 5000 });
  report.shortProposalGoal = await window.locator('.agent-goal').last().textContent();
  report.shortApplyEnabled = !(await window.locator('.agent-card').last().locator('.button-primary').isDisabled());
  await window.locator('.agent-card').last().locator('.button-primary').click();
  await window.waitForTimeout(500);
  report.lanesAfterShort = await window.locator('.lane').count();
  report.mediaClipsAfterShort = await window.locator('.clip-kind-media').count();
  report.shortAddedLanes = report.lanesAfterShort - lanesBeforeShort;
  report.shortAddedClips = report.mediaClipsAfterShort - clipsBeforeShort;
  report.highlightsLane = await window.locator('.track-header-name', { hasText: 'Highlights' }).count();
}

// Product templates: presets that build ordinary editable tracks and
// settings through the core operation layer (nothing locked in).
await window.locator('.rail-button[title="Templates"]').click();
await window.waitForTimeout(300);
report.templateCards = await window.locator('.template-card').count();
report.templateNames = await window.locator('.template-name').allTextContents();
const lanesBeforeTemplate = await window.locator('.lane').count();
await window.locator('.template-card', { hasText: 'Vertical Short' }).locator('.button').click();
await window.waitForTimeout(400);
report.lanesAfterTemplate = await window.locator('.lane').count();
report.templateAddedLanes = report.lanesAfterTemplate - lanesBeforeTemplate;
report.statusbarResolutionAfterTemplate = await window.locator('.statusbar-resolution').textContent();
report.reframeButtonPresent = await window.locator('.template-reframe').count();
await window.locator('.template-reframe').click();
await window.waitForTimeout(400);
report.statusbarResolutionAfterReframe = await window.locator('.statusbar-resolution').textContent();
report.templateVerticalLane = await window.locator('.lane', { hasText: 'Captions' }).count();

// Crop is first-class: the reframed crop shows in the preview (the crop
// viewport frames the kept region like the render plan) and every media
// clip's crop is adjustable in the Inspector through ordinary typed ops.
// Clips can overlap in time; the preview shows the TOPMOST active clip,
// which may differ from the selected one. Clips carry data-clip-id and
// the preview media element exposes the ACTIVE clip's id, so accept a
// clip only when selection and preview provably refer to the same clip
// (crop values alone are ambiguous - reframed clips share them).
let cropClipIndex = -1;
const clipTotalForCrop = await window.locator('.clip-kind-media').count();
const rulerBox = await window.locator('.ruler').boundingBox();
report.cropLoopTrace = [];
for (let i = 0; i < clipTotalForCrop; i += 1) {
  const clipBox = await window.locator('.clip-kind-media').nth(i).boundingBox();
  const selectedId = await window.locator('.clip-kind-media').nth(i).getAttribute('data-clip-id');
  await window.locator('.clip-kind-media').nth(i).click();
  // Selecting does not seek; click the ruler at the clip's center so the
  // playhead lands inside it and the preview shows that clip's framing.
  if (clipBox && rulerBox) {
    await window.mouse.click(clipBox.x + clipBox.width / 2, rulerBox.y + rulerBox.height / 2);
  }
  await window.waitForTimeout(150);
  const viewportCount = await window.locator('.preview-crop').count();
  const editorCount = await window.locator('.inspector-crop input[type="range"]').count();
  const activeId = viewportCount > 0
    ? await window.locator('.preview-crop .preview-media').first().getAttribute('data-clip-id')
    : await window.locator('.preview-video, .preview-image').first().getAttribute('data-clip-id');
  report.cropLoopTrace.push({ i, selectedId, activeId, viewportCount, editorCount });
  if (viewportCount === 0) continue;
  // Audio-only media clips show the preview but never offer crop editing.
  if (editorCount === 0) continue;
  if (activeId === selectedId) {
    cropClipIndex = i;
    break;
  }
}
report.cropClipIndex = cropClipIndex;
if (cropClipIndex >= 0) {
  report.cropEditorPresent = await window.locator('.inspector-crop').count();
  report.cropSliders = await window.locator('.inspector-crop input[type="range"]').count();
  report.cropViewportAfterSelect = await window.locator('.preview-crop').count();
  report.cropValuesBefore = await window.locator('.inspector-crop input[type="range"]').evaluateAll((els) => els.map((e) => e.value));
  await window.locator('.inspector-crop input[type="range"]').first().evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '45');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await window.waitForTimeout(250);
  report.cropViewportAfterEdit = await window.locator('.preview-crop').count();
  report.cropValuesAfterEdit = await window.locator('.inspector-crop input[type="range"]').evaluateAll((els) => els.map((e) => e.value));
  report.cropViewportStyle = report.cropViewportAfterEdit > 0 ? await window.locator('.preview-crop').first().getAttribute('style') : null;
  report.cropResetEnabled = !(await window.locator('.inspector-crop-reset').isDisabled());
  await window.locator('.inspector-crop-reset').click();
  await window.waitForTimeout(400);
  report.cropViewportAfterReset = await window.locator('.preview-crop').count();
  report.cropValuesAfterReset = await window.locator('.inspector-crop input[type="range"]').evaluateAll((els) => els.map((e) => e.value));
  report.cropToastsAfterReset = await window.locator('.toast').allTextContents();
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(250);
  report.cropViewportAfterUndo = await window.locator('.preview-crop').count();
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
// Storage: OVM-managed disk usage, with a clean action for interrupted
// downloads (models and generated outputs stay untouched).
report.storageCard = await window.locator('.device-card', { hasText: 'Storage' }).count();
report.storageModelRows = await window.locator('.device-row', { hasText: 'Kokoro-82M' }).count();
report.partialsRowVisible = await window.locator('.device-row', { hasText: 'Interrupted downloads' }).count();
report.cleanButtonPresent = await window.locator('.device-clean').count();
report.cleanButtonEnabled = report.cleanButtonPresent > 0 ? !(await window.locator('.device-clean').isDisabled()) : null;
if (report.cleanButtonEnabled) {
  await window.locator('.device-clean').click();
  // The clean triggers a SECOND full storage walk (models + all runtime
  // venvs, ~150k files) before the UI refreshes; give it real time.
  try {
    await window.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('.device-row') ?? []);
      const partialRow = rows.find((r) => (r.textContent ?? '').includes('Interrupted downloads'));
      return (partialRow?.textContent ?? '').includes('0 B');
    }, null, { timeout: 60000 });
  } catch (err) {
    const rowCount = await window.locator('.device-row', { hasText: 'Interrupted downloads' }).count();
    const rowText = rowCount > 0 ? await window.locator('.device-row', { hasText: 'Interrupted downloads' }).textContent() : '(row gone)';
    throw new Error('storage clean did not reach 0 B within 60s; row=' + rowText + '; ' + (err?.message ?? err));
  }
  report.cleanButtonAfter = !(await window.locator('.device-clean').isDisabled());
  report.partialsRowAfter = await window.locator('.device-row', { hasText: 'Interrupted downloads' }).textContent();
}
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

// Home: recent projects + template quick starts over the same project.
await window.locator('.topbar .icon-button[title="Home"]').click();
await window.waitForTimeout(400);
report.homeVisible = await window.locator('.home-view').count();
report.homeRecentRows = await window.locator('.home-recent').count();
report.homeRecentNames = await window.locator('.home-recent-name').allTextContents();
report.homeTemplateButtons = await window.locator('.home-template').count();
await window.locator('.home-recent').first().click();
await window.waitForTimeout(2000);
report.homeClosedAfterRecent = await window.locator('.home-view').count();
report.projectNameAfterRecent = await window.locator('.project-name').textContent();
report.recentLoadToast = (await window.locator('.toast').count()) > 0 ? await window.locator('.toast').textContent() : null;
const lanesBeforeHomeTemplate = await window.locator('.lane').count();
await window.locator('.topbar .icon-button[title="Home"]').click();
await window.waitForTimeout(300);
await window.locator('.home-template', { hasText: 'Vertical Short' }).click();
await window.waitForTimeout(500);
report.homeClosedAfterTemplate = await window.locator('.home-view').count();
report.lanesAfterHomeTemplate = await window.locator('.lane').count();
report.homeTemplateAddedLanes = report.lanesAfterHomeTemplate - lanesBeforeHomeTemplate;

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
if (report.transcriptSearchPresent !== 1) throw new Error('transcript search missing: ' + report.transcriptSearchPresent);
if (report.transcriptKeywordChips < 1) throw new Error('transcript keyword chips missing: ' + report.transcriptKeywordChips);
if (report.transcriptHitCount < 1) throw new Error('transcript search found nothing for a demo word: ' + report.transcriptHitCount);
if (report.timeAfterSearchSeek !== '00:00:02:00') throw new Error('search hit did not seek to 2.0s: ' + report.timeAfterSearchSeek);
if (report.timeAfterSearchReset !== '00:00:00:00') throw new Error('segment click did not reset the playhead to 0: ' + report.timeAfterSearchReset);
if (report.assetCountAfterVideoImport !== 8) throw new Error('video import failed: ' + report.assetCountAfterVideoImport);
if (report.redubSectionVisible !== 1) throw new Error('redub section missing from the inspector');
if (report.shotMarks < 2) throw new Error('shot markers missing from the clip: ' + report.shotMarks);
if (report.shotItems < 3) throw new Error('shot list missing from the inspector: ' + report.shotItems);
if (report.timeAfterShotSeek === '00:00:00:00') throw new Error('shot click did not seek the playhead');
if (report.shotEditingSkipped) {
  console.log('shot editing skipped (' + report.shotEditingSkipped + ')');
} else {
  if (!(report.removeSilenceLabel ?? '').includes('Remove silences')) throw new Error('remove-silence label missing: ' + report.removeSilenceLabel);
  if (!/\(-0\.\ds\)/.test(report.removeSilenceLabel ?? '')) throw new Error('silence duration missing from label: ' + report.removeSilenceLabel);
  if (!(report.splitAtShotsLabel ?? '').includes('Split')) throw new Error('split-at-shots label missing: ' + report.splitAtShotsLabel);
  if (report.mediaClipsAfterRemoveSilence !== report.mediaClipsBeforeActions + 2) throw new Error('remove silences should leave three pieces: ' + JSON.stringify({ before: report.mediaClipsBeforeActions, after: report.mediaClipsAfterRemoveSilence }));
  if (report.mediaClipsAfterSplit !== report.mediaClipsAfterRemoveSilence + 1) throw new Error('split at shots should add one piece: ' + JSON.stringify({ before: report.mediaClipsAfterRemoveSilence, after: report.mediaClipsAfterSplit }));
  if (report.mediaClipsAfterUndo !== report.mediaClipsAfterRemoveSilence) throw new Error('undo should restore the pre-split piece count: ' + JSON.stringify({ expected: report.mediaClipsAfterRemoveSilence, got: report.mediaClipsAfterUndo }));
}
if (report.templateCards !== 6) throw new Error('template cards missing (expected reframe card + 5 presets): ' + report.templateCards);
if (!(report.templateNames ?? []).some((n) => n.includes('Talking Video'))) throw new Error('talking video template missing: ' + JSON.stringify(report.templateNames));
if (report.templateAddedLanes !== 2) throw new Error('vertical short template should add two tracks: ' + report.templateAddedLanes);
if (report.templateVerticalLane !== 1) throw new Error('caption track missing after template: ' + report.templateVerticalLane);
if (!(report.statusbarResolutionAfterTemplate ?? '').includes('1080x1920')) throw new Error('template did not switch to vertical resolution: ' + report.statusbarResolutionAfterTemplate);
if (report.reframeButtonPresent !== 1) throw new Error('reframe button missing: ' + report.reframeButtonPresent);
if (!(report.statusbarResolutionAfterReframe ?? '').includes('1080x1920')) throw new Error('reframe did not keep vertical resolution: ' + report.statusbarResolutionAfterReframe);
if (report.cropClipIndex < 0) throw new Error('no reframed clip matches selection and preview: ' + JSON.stringify(report.cropLoopTrace));
if (report.cropEditorPresent !== 1) throw new Error('crop editor missing from the inspector: ' + report.cropEditorPresent);
if (report.cropSliders !== 4) throw new Error('crop sliders missing: ' + report.cropSliders);
if (report.cropViewportAfterSelect !== 1) throw new Error('preview does not show the reframed crop: ' + report.cropViewportAfterSelect);
if (report.cropViewportAfterEdit !== 1) throw new Error('crop edit lost the preview crop: ' + report.cropViewportAfterEdit);
if (report.cropValuesAfterEdit[0] !== '45') throw new Error('crop slider edit did not apply: ' + JSON.stringify({ before: report.cropValuesBefore, after: report.cropValuesAfterEdit }));
if (!(report.cropViewportStyle ?? '').includes('width:')) throw new Error('crop viewport style missing: ' + report.cropViewportStyle);
if (report.cropResetEnabled !== true) throw new Error('crop reset not enabled: ' + report.cropResetEnabled);
if (report.cropViewportAfterReset !== 0) throw new Error('crop reset did not clear the crop: viewport=' + report.cropViewportAfterReset + ' values=' + JSON.stringify(report.cropValuesAfterReset) + ' toasts=' + JSON.stringify(report.cropToastsAfterReset));
if (report.cropViewportAfterUndo !== 1) throw new Error('undo did not restore the reframed crop: ' + report.cropViewportAfterUndo);
if (report.assetCountAfterImageImport !== 9) throw new Error('image import failed: ' + report.assetCountAfterImageImport);
if (report.stillPreviewVisible !== 1) throw new Error('the imported still does not preview as an image: ' + report.stillPreviewVisible);
if (report.cutoutClipIndex < 0) throw new Error('no media clip offers the background-removal affordance (image kind not flowing through the bridge?)');
if (report.cutoutButtonEnabled !== true) throw new Error('cutout button not live');
if (!(report.cutoutButtonLabel ?? '').includes('Remove background')) throw new Error('cutout label missing: ' + report.cutoutButtonLabel);
if (process.env.OVM_CHECK_RMBG === '1') {
  if (!(report.cutoutDone ?? '').includes('Inspector')) throw new Error('real background removal did not complete: ' + report.cutoutDone);
  if (!(report.cutoutJobVisible ?? '').includes('Job Center')) throw new Error('cutout job missing from the Job Center');
  if (report.assetCountAfterCutout !== 10) throw new Error('cutout asset missing from the media panel: ' + report.assetCountAfterCutout);
  if (report.cutoutAddedLane !== 1) throw new Error('cutout track missing: ' + report.cutoutAddedLane);
}
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
if (report.shortButtonPresent !== 1) throw new Error('short creation affordance missing: ' + report.shortButtonPresent);
if (report.shortButtonEnabled !== true) throw new Error('short creation button not live');
if (!(report.shortProposalGoal ?? '').includes('short')) throw new Error('short proposal missing: ' + report.shortProposalGoal);
if (report.shortApplyEnabled !== true) throw new Error('short proposal not applyable');
if (report.shortAddedLanes !== 1) throw new Error('short should add one Highlights track: ' + report.shortAddedLanes);
if (report.shortAddedClips !== 2) throw new Error('short should assemble two highlight clips (spread by the 1.5s gap): ' + report.shortAddedClips);
if (report.highlightsLane !== 1) throw new Error('Highlights lane missing: ' + report.highlightsLane);
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
if (report.storageCard !== 1) throw new Error('storage card missing from the Device Center: ' + report.storageCard);
if (report.storageModelRows < 1) throw new Error('installed model sizes missing from the storage card: ' + report.storageModelRows);
if (report.partialsRowVisible !== 1) throw new Error('interrupted-download row missing: ' + report.partialsRowVisible);
if (report.cleanButtonPresent !== 1) throw new Error('storage clean button missing');
if (report.cleanButtonEnabled !== true) throw new Error('clean button should be enabled with a fake partial download present');
if (report.cleanButtonAfter !== false) throw new Error('clean button should disable after clearing: ' + JSON.stringify({ after: report.cleanButtonAfter, row: report.partialsRowAfter }));
if (!(report.mcpCommand ?? '').includes('ovm mcp --project')) throw new Error('MCP command missing: ' + report.mcpCommand);
if (!(report.mcpCommand ?? '').includes('desktop-check-project')) throw new Error('MCP command lacks the project dir: ' + report.mcpCommand);
if (report.homeVisible !== 1) throw new Error('home view missing: ' + report.homeVisible);
if (report.homeRecentRows < 1) throw new Error('recent projects missing from home: ' + report.homeRecentRows);
if (!(report.homeRecentNames ?? []).some((n) => n === report.projectName)) throw new Error('saved project not in recents: ' + JSON.stringify(report.homeRecentNames));
if (report.homeTemplateButtons !== 5) throw new Error('home template buttons missing: ' + report.homeTemplateButtons);
if (report.homeClosedAfterRecent !== 0) throw new Error('home did not close after opening a recent: ' + report.homeClosedAfterRecent + ' toast=' + report.recentLoadToast);
if (report.projectNameAfterRecent !== report.projectName) throw new Error('recent project did not load the saved project: ' + report.projectNameAfterRecent);
if (report.homeClosedAfterTemplate !== 0) throw new Error('home did not close after a template quick start: ' + report.homeClosedAfterTemplate);
if (report.homeTemplateAddedLanes !== 2) throw new Error('home template quick start should add two tracks: ' + report.homeTemplateAddedLanes);
if (report.transcribeEnabled !== true) throw new Error('transcribe affordance not live');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));
console.log('DESKTOP WINDOW OK');

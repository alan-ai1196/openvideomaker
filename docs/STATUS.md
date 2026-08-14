# OpenVideoMaker — current status

Updated: 2026-08-14 (round 30). This file is the single living status source; it
describes the repository truth and is updated whenever that truth changes.

## Done

- Monorepo foundation: pnpm workspaces + Turbo, TypeScript 7 strict ESM,
  Vitest 4 (with the Node-24 launcher workaround), Apache-2.0, git init.
- `@openvideomaker/schema` — durable Video IR (project/sequence/track/
  clip/asset/character/marker/effect/transition/caption/provenance),
  rational-frame-rate microsecond time, ~43 typed operations, transaction
  schemas. 18 tests.
- `@openvideomaker/core` — the single authoritative operation layer:
  `ProjectSession` (apply/transaction/undo/redo/replay/conflict checks),
  per-domain apply implementations, deterministic project invariants,
  builders, typed transaction scope. 39 tests.
- `@openvideomaker/persistence` — SQLite project store (better-sqlite3):
  project folder layout, snapshot + append-only log, incremental saves,
  divergence detection, corruption repair, compaction, relocation
  safety. 11 tests.
- `apps/studio` — Studio shell + design system: graphite design tokens
  (dark default + light, WCAG-AA-checked), Inter, i18n (en + zh-CN with
  typed key coverage), shell layout (top bar / media panels / preview
  stage / inspector / timeline / status bar), a real editable timeline
  (ruler, playhead, drag-move, edge trim, zoom/fit), selection + inspector
  editing (opacity, speed, gain, trim, text, enable, delete), undo/redo,
  keyboard shortcuts, project JSON save/open, and an honest placeholder
  preview stage. Playwright-validated (layout, interactions, contrast).
- `@openvideomaker/media` — Node media indexing: ffprobe probing (exact
  rational fps, codecs, channels), ffmpeg filmstrip thumbnails, waveform
  peaks; tested against real generated media (6 tests).
- Studio media pipeline: browser probing, import via picker + drag-drop,
  click-to-place with insert edits, real playback in the preview stage,
  clip thumbnails + waveforms, split-at-playhead (S), ripple delete (Del),
  lift (Shift+Del). Core insert-edit/ripple/split commands with tests.
  Playwright-validated end to end.
- `@openvideomaker/render` — authoritative final rendering: Video IR →
  render plan → FFmpeg. Probed encoders (software + NVENC/AMF/QSV/Video-
  Toolbox) with automatic hardware→software fallback, RenderJobs with
  progress/cancel/classified errors, `ovm-render` CLI, real E2E render
  verified with ffprobe (9 tests).
- Studio Export dialog: presets (1080p/vertical/square/source), quality,
  honest browser-mode capability note + exact local render command,
  project download. Playwright-validated.
- `@openvideomaker/registry` — machine-validated model registry:
  capability catalog, 9 factual seed entries (ASR/TTS/lip-sync/video/
  image/enhancement; licenses and hub ids verified against the HF and
  ModelScope APIs), honest unverified trust states, generated
  `docs/models.md` with a drift check (10 tests).
- `@openvideomaker/downloader` — content-addressed model store (sha256
  dedup), dual-hub + mirror providers with priority profiles, resumable,
  cancellable, integrity-verified downloads, manifest-pinned revisions
  (12 tests against a real local HTTP server).
- Studio Model Center: category browsing, trust badges, license notes,
  evidence lines, honest browser-mode install state; Playwright-validated.
- `@openvideomaker/runners` — language-neutral NDJSON runner protocol
  (describe/prepare/execute/progress/cancel/health/dispose), crash-safe
  RunnerHost with timeouts and bounded logs, uv-isolated runtimes with
  content-keyed manifests (6 tests incl. crash isolation).
- `@openvideomaker/devices` - the probed device graph: OS/CPU/memory,
  NVIDIA GPUs via nvidia-smi (name/VRAM/driver/CUDA), ffmpeg version
  and probed encoders (reusing render's detection), toolchain runtimes
  (node/ffmpeg/ffprobe/uv/python with a `py` fallback), derived
  capabilities, and the `ovm-doctor` CLI (`--json` / `--strict`).
  Absence is data, never an error; hardware is probed, never assumed
  (8 tests, verified on this machine: RTX 3090 24GB, CUDA 13.3,
  NVENC encoders, uv + Python detected).
- **First real verified integration**: `runners/kokoro-tts` - Kokoro-82M
  weights fetched through the artifact store, model loaded in an isolated
  uv runtime, TTS executed through the runner protocol, 3.3s 24kHz WAV
  confirmed with ffprobe. Registry entry marked `verified` with measured
  sha256s and dated evidence.
- **Second verified integration**: `runners/whisper-asr` - Whisper Large
  v3 via faster-whisper: the official CTranslate2 weights (2.9GB model.bin
  pinned from the HF LFS oid) fetched through the artifact store, an
  isolated uv runtime carrying the `nvidia-cublas-cu12` wheel for
  toolkit-free CUDA (DLL dirs registered by the adapter), and `audio.asr`
  through the runner protocol on Kokoro-synthesized speech: 8/8 word
  overlap on CUDA float16 (RTX 3090), timed transcript + SRT captions.
  Registry entry `hf/openai/whisper-large-v3` marked `verified`; the
  TTS -> ASR loop runs end to end.
- **Third verified integration**: `runners/paraformer-asr` - FunASR
  Paraformer-large (Mandarin ASR): 840MB weights fetched through the
  artifact store from ModelScope, an isolated uv runtime (funasr 1.4.1
  + torch, CPU), and `audio.asr` through the runner protocol on
  Windows-SAPI-synthesized Mandarin speech (Huihui voice): 14/14
  character overlap, transcript + SRT captions. Registry entry
  `ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
  marked `verified`; the adapter keeps funasr's stdout away from the
  protocol stream.
- `@openvideomaker/downloader` hardening: store hashing now streams (the
  first >2GiB artifact - whisper's weights - exposed the readFileSync
  buffer limit), with a regression test for large-file adoption;
  `installModel` reports progress and accepts an abort signal.
- `@openvideomaker/jobs` - generation jobs end to end: capability
  requests resolve adapters data-driven from `runners/<name>/runner.json`
  manifests, install through the artifact store, run in uv-isolated
  runtimes over the runner protocol, and land in projects ONLY through
  core ops with full provenance (`attachGeneratedMedia` /
  `attachGeneratedFile` / `attachTranscriptCaptions`). Uniform job
  shape (state/progress/logs/cancel) with RenderJob/DownloadJob.
  Verified for real: Kokoro TTS -> voiceover asset, Whisper ASR (CUDA)
  -> caption clips + subtitle asset, all provenance recorded in the
  saved project (6 tests + re-runnable `packages/jobs/verify.mjs`).
- Studio Model Center: honest Generate affordance - disabled in browser
  mode (`capabilities.localGeneration === false`) with an explanation
  that generation runs in the desktop app; Playwright-verified.
- **Transcripts as durable project data**: a time-aligned segment model
  linked one-to-one to assets with typed operations (create/setSegments/
  setSegmentText/setLanguage/remove), invariant checks and full history;
  ASR/import/manual sources are distinguishable and ASR transcripts
  carry generation provenance. Caption clips are DERIVED from
  transcripts via the core command `syncCaptionsFromTranscript`
  (idempotent, undoable) - jobs now land ASR results as transcript
  documents + captions through that same command (6 core tests, jobs
  test extended). Studio Transcript panel: click a segment to seek,
  correct text inline, sync captions; the welcome project ships a demo
  transcript. Playwright-verified (seek/edit/sync, no page errors).
- **Character Studio**: the Avatars tab is a real panel over the
  existing character IR - create/reuse characters with identity
  (name/description), voice (provider chosen from the registry's
  verified `audio.tts` models + voice id + consent record), performance
  defaults (realism/gesture/head-motion/emotion) and advanced
  capability/model preferences. Every edit is a typed, undoable
  operation; `CharacterPatch` now deep-merges defaults to match the
  apply semantics; the welcome project ships a demo character (Ava).
  Voiceover generation is honestly disabled in browser mode.
  Playwright-verified (create/rename/voice/consent/slider/delete/undo).
- `@openvideomaker/agent` - agent editing foundation: EditPlan (goal,
  evidence, constraints) and EditScript (a RESTRICTED declarative
  program over the editing domain - track.create, clip insert/remove/
  move/trim, text/caption inserts, `$variable` bindings - never eval).
  `compileEditScript` emits the standard typed operations; previews run
  on a scratch copy and report invariant violations; proposals apply as
  one undoable transaction with actor 'agent'. The Studio Agent panel
  (honest: the LLM planner is future work) drives the real pipeline
  with a deterministic planner that re-inspects the project -
  Playwright-verified end to end (propose, preview, apply, re-plan,
  caption track via variable binding). 5 agent tests.
- `@openvideomaker/mcp` - MCP server (spec 2025-06-18, JSON-RPC over
  newline stdio): a semantic, capability-first tool set over the same
  operation layer (project.inspect/create/dump, timeline/transcript/
  character.inspect, character.create, edit.preview/edit.apply via
  EditScripts, model.list/search/info) plus project:// and model://
  resources; all boundaries zod-validated; tool failures are content
  errors, not protocol faults (7 tests + a real stdio e2e check).
- `@openvideomaker/cli` - the `ovm` CLI: doctor / models list|search|
  info / render / mcp, each delegating to the same packages the
  Studio uses (5 tests; binary runs verified).
- **Marketing site** (`apps/site`, Astro): hero, editor/AI/developer
  sections with REAL Studio screenshots, an honest docs page mirroring
  the repository status, and no fake completeness - deployed to
  `https://openvideomaker.heartboat.me` as a Cloudflare Workers
  static-assets project (custom domain verified over HTTPS, 404 and
  image serving confirmed). Visual + dead-link checks included.
- **Script-first editing**: a durable Script document (ordered speech
  lines linked to characters/voices with optional timeline placement)
  with six typed operations, invariant checks and full history; the
  core command `syncTextClipsFromScript` places lines on a Script text
  track (timed lines exactly, untimed lines sequentially with a
  deterministic duration estimate; idempotent + undoable). Studio
  Script panel: write, edit, link characters, set times, seek and
  place - the welcome project ships a demo script. 4 core tests +
  Playwright-verified (edit/seek/place, no page errors).
- **Electron desktop shell** (`apps/desktop`): one window around the
  SAME Studio build (relative asset base; file:// loading verified),
  sandboxed renderer (contextIsolation, no nodeIntegration) with a
  narrow CJS preload exposing a typed `window.ovm` bridge
  (capabilities, openProject, saveProject, runDoctor). Real today:
  SQLite project folders via the persistence package + device probing;
  localRender/localGeneration stay honestly false until their IPC
  paths exist. Verified: headless smoke (persistence round trip +
  doctor inside Electron) and Playwright's Electron driver against the
  real window (Studio renders, bridge live, zero errors).
- **Desktop generation slice**: REAL local AI generation through the
  bridge - `DesktopGenerationService` wraps the same `GenerationRunner`
  the SDK/CLI use (registry + content store + uv runtimes + runner
  protocol), `ovm:generate` IPC with progress events and cancellation,
  zod-validated requests, and `modelInputs` resolved against the store
  revision so renderer code never knows weight paths. Results land in
  projects ONLY through the typed operation layer: generated assets
  via the core `generatedAsset` builder, transcripts via the new
  shared core command `attachAsrResult` (jobs' node-side
  `attachGeneratedTranscript` now delegates to it), captions via
  `syncCaptionsFromTranscript`. The `ovm-media://` protocol lets the
  sandboxed renderer play local media (imports, generated outputs,
  renders, project assets) from a strict allow-list - never arbitrary
  filesystem access. `localGeneration` is runtime-confirmed (true only
  when the service builds) and the Character Studio voiceover, Model
  Center sample and Transcript transcribe affordances are live in the
  desktop app with progress + cancel. Verified: the headless smoke
  runs a REAL Kokoro TTS -> Whisper ASR -> transcript + caption clips
  round trip inside Electron (2.55s of audio, 1 segment, 1 caption),
  and Playwright's Electron check confirms the live affordances
  (voiceover/sample/transcribe enabled, generation capability list
  from runner manifests, zero page errors).
- **Desktop render slice**: real local rendering through the bridge -
  `import-media` (native picker + ffprobe) and `render` (save dialog,
  render plan + ffmpeg with progress events) in the main process, the
  Export dialog's honest Render button with progress + output path,
  and `localRender: true` now REAL. Verified: the smoke test renders a
  1s mp4 end to end inside Electron (probed duration 1.0s) and
  Playwright confirms the dialog's Render flow with zero errors.
- **Script-first speech generation**: the core `planScriptPlacements`
  helper is now the single source of truth for where script lines land
  (timed lines use their own timing, untimed lines follow sequentially
  with a deterministic estimate) - both the text-clip sync and desktop
  speech generation place through it, so text and audio can never
  disagree on timing. Each script line has a live 'Generate speech'
  affordance in the desktop app (same TTS path as the Character
  Studio): the audio lands at the line's planned position as an insert
  edit, and the line's real spoken duration becomes its authoritative
  start/duration, so re-syncing text clips follows the speech.
  Browser mode stays honestly disabled. Verified: 3 new core tests for
  the placement plan, and the Playwright Electron check clicks the
  real Generate speech button (Kokoro TTS runs inside the desktop app,
  the line gains a start time, the asset appears in the Media panel).
- **Fourth verified integration**: `runners/latentsync` - LatentSync 1.5
  (ByteDance, Apache-2.0 code / OpenRAIL++ weights) for the
  `avatar.lip_sync` capability: the vendored upstream inference package
  (pinned commit, training modules excluded, adapter patches marked),
  a hermetic reimplementation of the upstream inference entrypoint, and
  a pinned file manifest (UNet 4.83GiB + whisper tiny + SD VAE
  safetensors + InsightFace buffalo_l, sha256s measured from the
  official hub). Windows-specific upstream gaps are fixed in the
  adapter (decord-free ffmpeg audio, argument arrays instead of shell
  interpolation, InsightFace models pre-placed from the artifact store
  so the runtime performs NO downloads). Verified end to end on an RTX
  3090 (CUDA fp16, 512px): 5.08s 1080x1920 mp4 with video+audio, face
  detected (0.87), mouth region changed 7.9x the frame average while
  the surrounding pixels stayed intact (MAD 1.65). Registry entry
  `hf/bytedance/latentsync-1.5` marked `verified` with dated evidence.
- **Runner-host hardening (found by the latentsync slice)**: a Python
  thread iterating stdin deadlocks torch/numpy imports on Windows
  (reproduced minimally; OpenBLAS console init) - the adapter
  pre-imports at module level and documents why; `RunnerHost.dispose`
  now hard-stops a runner that ignores dispose by killing the whole
  process tree (uv-venv python.exe is a launcher whose real
  interpreter is a child; killing only the launcher orphaned live
  model processes holding GPU memory) - regression-tested; the
  GenerationRunner describe timeout allows 2 minutes for cold-start
  imports.
- **Desktop Redub flow**: lip sync inside the editing workflow - select a
  talking-head clip in the timeline, pick a replacement audio asset, and
  the Inspector's AI actions run `avatar.lip_sync` through the desktop
  bridge (the verified LatentSync runner): the synced video lands as a
  provenance-carrying asset on a NEW 'Lip sync' track at the source
  clip's start, so the original stays intact for comparison and every
  result remains fully editable. Browser mode hides the affordance
  honestly. Playwright-verified in the desktop app (affordance live,
  audio options from real assets, zero errors) with an opt-in
  `OVM_CHECK_LIPSYNC=1` click-through that runs the REAL GPU job
  through the UI.
- **Job Center**: long-running work is visible - every generation and
  render registers as a uniform job (label, state, progress, stage,
  cancel) on the new Jobs tab. Generation jobs adopt the main
  process's job id from the first progress event, so Cancel really
  cancels the backend job; renders got `ovm:render-cancel` IPC (the
  main process tracks active RenderJobs). A failed/cancelled job never
  touches the project - results only ever arrive through the typed
  operation layer. Verified: the Playwright Electron check sees the
  real Kokoro voiceover job as Completed in the Job Center, the opt-in
  full lip-sync run sees it RUNNING with a progress bar + cancel
  button and then Completed, and the browser Studio shows the honest
  empty state.
- **Model install in the desktop app**: the Model Center's Install
  button is real - `ovm:model-install` IPC runs the content store's
  verified, resumable install (progress events + cancellation), the
  store gained `installedModels()` (manifest-pinned revision list),
  and cards read the live installed state ('Installed' for the four
  verified models). Installs are ordinary Job Center jobs ('Install'
  kind) with progress and cancel; entries without a verified file
  manifest stay honestly disabled. Verified in the desktop app
  (kokoro/whisper read Installed, the bridge reports the store's
  manifest set, zero errors).
- **LLM planner behind the proposal contract**: `LlmPlanner` in the
  agent package turns a natural goal + a compact, id-complete project
  description (`describeProjectForPlanner`) into a declarative
  EditScript through any OpenAI-compatible chat endpoint - the model's
  ONLY output is data, validated by the EditScript schema (with one
  repair round using the exact validation error) and compiled against
  the REAL project by the same deterministic pipeline the demo planner
  uses. The desktop app exposes it through `ovm:agent-plan` IPC when
  `OVM_LLM_ENDPOINT`/`OVM_LLM_MODEL` are configured and advertises
  `llmPlanner` honestly; the Studio Agent panel gains an 'AI plan'
  input whose proposals flow through the same preview/apply (one
  undoable transaction)/reject UI. Verified: 4 agent tests against a
  real local HTTP endpoint (wire path, repair round, clean failure),
  and the Playwright Electron check runs the whole chain with a
  scripted endpoint (configured -> advertised -> plan -> apply ->
  caption track on the timeline) plus the honest unconfigured default
  (not advertised, section hidden). Real-model verification awaits a
  configured provider - stated, never implied.
- **Device Center**: the probed device graph gets a real Studio
  surface (Devices tab) sharing `ovm doctor`'s logic - friendly first
  ('Your PC is ready for local AI.' when a GPU was probed), then this
  computer / video encoding / runtimes / recommendations / warnings,
  with the raw developer report behind progressive disclosure. The
  desktop bridge's `ovm:doctor` now returns the graph + the derived
  recommendations + the formatted report; the browser Studio honestly
  says diagnostics run in the desktop app. Playwright-verified in the
  desktop app (RTX 3090 row, ffmpeg encoders, recommendations, raw
  report, zero errors) and in the browser (honest empty state).
- **Local MCP server for the open project**: `ovm-mcp`/`ovm mcp` gain
  `--project <folder|.ovm.json>` - the server binds an EXISTING saved
  project (shared `openProjectForMcp` loader: SQLite folders and .ovm.json
  exports) so agents see exactly what the Studio saved, with project
  tools/resources reading the real state. The desktop app's Device Center
  gained a Developer section: once the project is saved it shows the
  exact connection command (`ovm mcp --project "<dir>"`) with a copy
  button, and an honest 'save first' hint before that. Verified: the
  mcp-check now runs a second server against a real saved project
  (name + media preserved through --project), and the Playwright
  desktop check saves through the UI and asserts the command contains
  the saved folder.
- **Long-project hardening**: the timeline virtualizes clip DOM nodes
  to the visible window (plus a margin; the dragged clip is always
  rendered), so a REAL 1500-clip project loads in ~0.7s with 18 DOM
  nodes instead of 1500 - and stays interactive at any scroll position.
  A new long-project check loads a generated 1500-clip project in the
  browser, scrolls far into it (virtualized at both ends), selects a
  clip, seeks the playhead at 1:06:12, and asserts zero errors; all
  existing Playwright checks still pass.
- **Installer packaging**: electron-builder produces a real
  distributable (`pnpm desktop:package`): an NSIS setup exe + unpacked
  build carrying the Studio dist, the registry data and the runner
  adapters in the app resources, with packaged path resolution
  (resourcesPath) and the userData home for models/runtimes. Verified
  against the PACKAGED binary: the headless smoke renders + runs real
  Kokoro TTS + Whisper ASR inside the distributable (4
  capability/model pairs ready), and a Playwright packaged-check
  launches the installed exe and sees the real Studio window, live
  bridge and all four installed models with zero page errors.
- **Media intelligence Level 1**: deterministic, model-free structure
  derived on desktop import - shot boundaries (ffmpeg scene-change),
  per-shot keyframe points, and audio silence regions
  (`@openvideomaker/media` analyzeMedia/detectShots/detectAudioRegions,
  3 new tests against synthesized multi-scene + silence fixtures). The
  Studio renders shot markers inside media clips and a clickable shot
  list in the Inspector (click seeks the playhead); analysis is
  session-scoped presentation data, never durable state. Verified in
  the desktop app (3 scenes detected on the imported test video,
  shot click seeks to 00:00:01:15, zero errors). This is the first
  rung of the media understanding hierarchy for future agent edits.
- **MuseTalk assessed and honestly deferred**: the v1.5 inference path
  requires mmpose (rtmpose landmarks), whose chumpy dependency does
  not build on Windows py3.12 in isolated uv runtimes (dry-run
  executed). The registry entry now carries the FULLY measured file
  manifest (unet 3.4GB, whisper-tiny, face-parse, face-alignment, SD
  VAE - sha256s from official hubs) so installation is ready, the
  evidence text states the exact blocker, and
  docs/research/musetalk-mmpose-blocker.md records the analysis; no
  runner is shipped, so the Studio honestly reports 'no runner
  adapter' instead of pretending support.
- Docs: AGENTS.md, README, architecture docs, ADRs 0001-0009, UX
  principles, SECURITY/CONTRIBUTING/notices.

## Next (in planned order)

1. More verified runner integrations (avatars/video next; MuseTalk
   documented as blocked on mmpose/chumpy).
2. App icons, code signing, auto-update; macOS/Linux packaging
3. Media intelligence Levels 2-4 (summaries, entities, narrative) and
   silence removal / shot-based editing commands
3. Desktop slices: model install, local MCP; Model/Device/Job
   Centers; installer packaging (bundle registry + runner adapters,
   userData paths); long-project performance hardening.

## Known environment notes

- Vitest 4 on Node ≥ 23.6 requires `--no-experimental-strip-types`; the
  package test scripts handle this via `scripts/vitest.mjs`.
- Cloudflare Wrangler is authenticated (workers/pages write); the site
  deployment step is still to come.
- Dev machine: Windows, RTX 3090 24GB — CUDA is a first-class target;
  MLX/ROCm remain unverified until real hardware evidence exists.
# AGENTS.md — OpenVideoMaker repository invariants

> Read this before writing code. It is operational, not philosophical; when
> it conflicts with a plan, fix the plan.

## What this repository is

OpenVideoMaker: **Make videos with AI. Keep everything editable.** A
polished open-source video creation application (Studio UI, desktop shell,
TypeScript core, model runners, MCP/SDK/CLI, marketing site). Pre-release.

## Product invariants (do not break these)

1. **One product model, many interfaces.** Studio, MCP, SDK, CLI and agents
   mutate projects ONLY through the typed operation layer in
   `packages/core` (`ProjectSession.apply/transaction`). Never add a second
   implementation of business logic in UI, MCP, or CLI code.
2. **Project-changing means logged.** Every meaningful mutation is a typed
   operation in an append-only log with undo/redo, deterministic replay,
   and optimistic checkpoint-based concurrency. No silent state writes.
3. **Models are not hardcoded outside the registry/provider boundary.**
   Core/UI ask for capabilities (e.g. `avatar.lip_sync`), never
   `run_latentsync()`. Upper layers must not import model-specific runners.
4. **Generated media records provenance.** Every generated asset carries
   capability, model+revision, runner, settings, inputs, and regeneration
   info. Generated clips are never anonymous files.
5. **Untrusted data is validated at boundaries.** Zod schemas cover
   operations, transactions, project snapshots, and (future) wire/durable
   payloads. Trust TypeScript only at safe same-process typed boundaries.
6. **Core TypeScript never executes arbitrary downloaded model code by
   default.** Runner code is first-party/verified adapters or explicitly
   trusted isolated runtimes. See `SECURITY.md`.
7. **Current docs match current code.** Update the authoritative doc in the
   same change that alters the truth. ADRs are historical and never
   rewritten.

## Layout and dependency direction

- `apps/*` — Studio (React), desktop (Electron), site (Astro).
- `packages/*` — libraries. `schema` (Video IR, zod) → `core` (operations,
  sessions, invariants) → everything else. Dependency direction is
  strictly schema ← core ← (ui, mcp, sdk, cli, ...).
- `runners/*`, `registry/` — model adapters and registry data (later).
- `docs/` — architecture, product, ADRs, research notes.
- `scripts/` — dev tooling (e.g. the vitest launcher).

New behavior belongs in the package that owns that concept: project
semantics in `core`; durable shapes in `schema`; presentation in UI.
Do not create empty packages to match the architecture diagram; create a
package when it has real code.

## Commands

```bash
pnpm install          # install (pnpm >= 10)
pnpm build            # turbo build all packages
pnpm test             # turbo test all packages
pnpm typecheck        # turbo typecheck all packages
pnpm --filter @openvideomaker/core test   # single package
```

Node >= 22.12, pnpm 10, TypeScript 7 (native compiler), ESM throughout.
**Do not run vitest directly on Node >= 23.6** — native TS type-stripping
breaks vitest 4 test collection in this environment. Use the package
`test` script (which goes through `scripts/vitest.mjs`) or set
`NODE_OPTIONS=--no-experimental-strip-types`.

## Testing policy

- Evidence proportional to the changed surface: operation/transaction
  behavior, replay determinism, invariants, schema boundaries — always.
- Every declared operation type must have an apply implementation;
  `test/registry.test.ts` enforces this. Add both when adding an op.
- UI work is not complete until the app runs and looks right; use
  screenshots/browser automation when available.
- Run full `pnpm test` + `pnpm build` at integration gates, not after
  every trivial edit.

## Windows is a first-class platform

No POSIX-only assumptions: no hardcoded `/` paths, no Unix signals in
child-process handling, no shell interpolation for command construction
(argument arrays only). Test spaces in paths.

## Git hygiene

Commit coherent milestones only. Never commit weights, upstream clones
(keep them in `.research/`), caches, build output, user projects, or
secrets. Inspect the diff before committing. No force pushes.

## Security boundaries (see SECURITY.md)

- Safe argument arrays, never interpolated shell strings.
- Minimize Electron renderer privileges; context isolation; narrow preload.
- Model downloads never imply executing downloaded repository code.
- No secrets in logs, docs, tests, or the repo.

## Current state (pre-release)

Foundation stage. Implemented: `@openvideomaker/schema` (durable Video IR
and typed operation vocabulary), `@openvideomaker/core` (operation
engine: transactions, undo/redo, replay, concurrency, invariants),
`@openvideomaker/persistence` (SQLite project store), `@openvideomaker/media`
(Node media indexing: ffprobe probing, thumbnails, waveforms - browser
mode has equivalent implementations inside the Studio behind the same
schemas) and `apps/studio` (the React editor: editable timeline, real
media import + preview playback, insert edits, split/ripple delete; see
`docs/adr/0005-studio-one-way-data-flow.md` and `docs/adr/0006-media-pipeline.md`).
Studio must mutate projects ONLY through `controller.mutate` -> core ops,
and must never mirror project state in a second store. Media presentation
caches (thumbnails, waveforms, object URLs) are session-scoped and never
durable project state. Final rendering lives in `@openvideomaker/render`
(render plans from the Video IR, probed encoders with hardware-to-software
fallback, RenderJobs, `ovm-render` CLI); the browser Studio must NEVER
pretend to run FFmpeg - its Export dialog prepares the project and shows
where rendering runs. `@openvideomaker/registry` is the single source of
model truth (capability-first, trust states, generated `docs/models.md`);
`@openvideomaker/downloader` stores artifacts content-addressed with
resumable verified downloads - downloads NEVER execute downloaded code,
and entries without verified file manifests refuse to install.
`@openvideomaker/runners` is the language-neutral NDJSON runner protocol
(describe/prepare/execute/progress/cancel/health/dispose) with a crash-safe
host and uv-isolated runtimes under OVM-managed directories; adapters are
first-party code in `runners/<name>/` and the first verified integration
is `runners/kokoro-tts` (registry entry `verified` with dated evidence).
Trust states change ONLY with real execution evidence.
`@openvideomaker/devices` is the probed device graph (OS/CPU/memory,
NVIDIA GPUs via nvidia-smi, ffmpeg version + probed encoders, toolchain
runtimes) with the `ovm-doctor` CLI (`--json`/`--strict`); hardware is
probed, never assumed, and absence is data - it feeds the future Device
Center. Verified runner integrations: `runners/whisper-asr` (Whisper
Large v3 via faster-whisper: CTranslate2 weights through the artifact
store, the nvidia-cublas-cu12 wheel registered by the adapter so CUDA
needs no system toolkit, 8/8 word overlap on the TTS -> ASR loop on an
RTX 3090); the downloader store streams hashes so >2GiB artifacts work.
`@openvideomaker/jobs` runs capability requests through registry +
artifact store + uv runtime + runner protocol (data-driven
`runners/<name>/runner.json` manifests) and lands every result in
projects through core ops with full GenerationProvenance - verified for
real (TTS voiceover asset, ASR caption clips + subtitles in a saved
project). `runners/paraformer-asr` is the third (FunASR Paraformer
Mandarin ASR: ModelScope weights through the artifact store, 14/14
character overlap on Windows-SAPI-synthesized speech; the adapter keeps
funasr's stdout away from the protocol stream). `runners/latentsync` is
the fourth (LatentSync 1.5 avatar.lip_sync: the vendored upstream
inference package at a pinned commit with marked adapter patches, a
pinned file manifest, and real CUDA fp16 verification on an RTX 3090 -
5.08s 1080x1920 output, mouth region changed 7.9x the frame average;
the adapter pre-places InsightFace models so the runtime never
downloads). Runner-host hardening from that slice: heavy imports must
happen at module level BEFORE a stdin reader thread starts (Windows
torch/numpy import deadlock - reproduced), and RunnerHost.dispose
hard-stops ignored disposes by killing the process tree (uv-venv
launchers orphan their real interpreter otherwise) - both
regression-tested. The Studio Model Center
shows Generate honestly disabled in browser mode. Transcripts are
durable project data (segments linked one-to-one to assets, typed ops,
invariants, history, ASR provenance); caption clips derive from them
via the core command `syncCaptionsFromTranscript`, and the Studio
Transcript panel seeks/edits/syncs them. The Character Studio (Avatars
tab) manages persistent characters over the character IR - identity,
voice (registry-verified TTS providers + consent records), performance
defaults, advanced preferences - all typed, undoable operations, with
voiceover generation honestly disabled in browser mode.
`@openvideomaker/agent` is the agent editing foundation: EditPlan +
EditScript (restricted declarative steps with $variable bindings, never
eval) compile to the standard typed operations; previews run on scratch
copies; proposals apply as one undoable agent transaction. The LlmPlanner
turns a natural goal + a compact id-complete project description into a
validated EditScript through any OpenAI-compatible endpoint (one repair
round; the model's only output is data, compiled against the REAL
project); the desktop app exposes it through ovm:agent-plan IPC when
OVM_LLM_ENDPOINT/OVM_LLM_MODEL are configured and advertises
llmPlanner honestly - the Studio Agent panel's 'AI plan' uses the same
proposal UI, and the deterministic planner remains the honest default. `@openvideomaker/mcp` exposes that contract
to agents as an MCP server (spec 2025-06-18, stdio): semantic tools
(project/timeline/transcript/character inspect+create, edit.preview/
edit.apply, model search) over the SAME operation layer, with
project:// and model:// resources; surfaces the host cannot run yet
(install, generation, render submission) are honestly not advertised
until the desktop core exists. `@openvideomaker/cli` provides
`ovm doctor | models | render | mcp`, delegating to the same
packages. The marketing site (`apps/site`, Astro) is live at
`https://openvideomaker.heartboat.me` (Cloudflare Workers static
assets, custom domain; real Studio screenshots, honest status copy);
deploy with `pnpm site:deploy`, verify with `pnpm site:check`.
Scripts are durable project data (ordered speech lines linked to
characters, six typed operations); `planScriptPlacements` is the
single timing plan - `syncTextClipsFromScript` places text clips
from it, and desktop speech generation places REAL TTS audio from
it (each line's spoken duration becomes its authoritative timing).
The Studio Script panel edits, seeks, syncs and speaks lines (the
latter live in the desktop app, honestly disabled in the browser). `apps/desktop` is the Electron shell over the
SAME Studio build: sandboxed renderer, narrow typed CJS preload
(`window.ovm`: capabilities/openProject/saveProject/runDoctor/import/
render/generate), real SQLite persistence + device probing + REAL
local rendering (import-media with native paths, render IPC with
progress; the Export dialog's Render button is live, `localRender:
true`) + REAL local generation (DesktopGenerationService over the
same GenerationRunner the SDK/CLI use; `ovm:generate` IPC with
progress + cancel; `modelInputs` resolve model-owned files against
the store revision; results land via the typed operation layer -
`generatedAsset` imports and the shared core `attachAsrResult`
command; the ovm-media:// protocol serves ONLY allow-listed local
paths so the sandboxed renderer can play imported/generated media;
`localGeneration` is runtime-confirmed, true only when the service
builds). Live desktop affordances: Character Studio voiceover, Model
Center TTS samples, Transcript panel transcription, and the Redub
flow (select a talking-head clip, pick replacement audio, and the
Inspector's AI actions run avatar.lip_sync through the bridge - the
synced video lands on a new 'Lip sync' track with full provenance;
opt-in OVM_CHECK_LIPSYNC=1 click-through runs the REAL GPU job
through the UI). The Job Center (Jobs tab) makes every long-running
unit of work visible with progress and cancellation: generations and
renders register uniform jobs (the render path gained
ovm:render-cancel IPC), generation jobs adopt the backend job id from
the first progress event so cancel reaches the real job, and failed
or cancelled work never touches the project. Model installation is
real too: the Model Center's Install button runs the content store's
verified resumable install through ovm:model-install IPC (progress +
cancel, an ordinary Job Center job), the store's installedModels()
feeds the live 'Installed' card state, and entries without a verified
file manifest stay honestly disabled. The Device Center (Devices tab)
surfaces the probed device graph with ovm doctor's logic: friendly
first ('Your PC is ready for local AI.'), details + recommendations
behind progressive disclosure, the raw report for developers, and an
honest 'runs in the desktop app' state in the browser. The MCP server
attaches to real projects: ovm-mcp / ovm mcp accept --project (a saved
project folder or a .ovm.json export) through the shared
openProjectForMcp loader, and the Device Center's Developer section
shows the exact connection command for the desktop's saved project
(copy button; honest 'save first' hint before that). The timeline virtualizes clip
DOM nodes to the visible window (long projects stay responsive:
1500 clips load in ~0.7s with ~18 nodes rendered; verified by the
long-project Playwright check, including selection and seeking far
into the timeline). Snapping lands: dragged clips and trims attach
to the playhead and every other clip's edge within ~8px, with an
accent guide line while attached (a pure snap module -
presentation-only, commits stay ordinary typed operations).
Verified by the extended drag-check (4 scenarios: plain move,
edge snap, playhead snap, trim-in snap - each asserts the guide
during the drag, the exact target position after, and the guide
clearing on drop). Installer packaging is real: pnpm desktop:package
builds an NSIS setup + unpacked app carrying the Studio dist, registry
data and runner adapters in resources (packaged path resolution +
userData homes for models/runtimes); the packaged binary passes the
full smoke (render + real TTS/ASR) and the Playwright packaged-check
(real window, live bridge, installed models, zero errors). Media
intelligence Level 1 runs on desktop import (shot boundaries,
keyframe points, silence regions - ffmpeg-derived, model-free,
session-scoped): clips show shot markers and the Inspector lists
clickable shots. MuseTalk is assessed and honestly deferred: its v1.5
path needs mmpose whose chumpy dependency does not build on Windows
py3.12 in isolated uv runtimes (registry manifest fully pinned, blocker
documented in docs/research/musetalk-mmpose-blocker.md, no runner
shipped). Media intelligence Level 2 is model-free: pure
transcript-to-shot alignment, per-shot speech flags, per-shot motion
(ffmpeg signalstats YDIF) and speech/motion/still classification ship
as `@openvideomaker/media/shot-analysis` (type-only imports keep the
browser bundle free of the ffmpeg runner), and the shot structure now
drives real edits through the operation layer: the core commands
`splitClipAtTimes` (one atomic multi-split) and
`removeRangesFromClip` (clamped/merged ranges, head/tail trims,
ripple-closed jump cuts, whole-clip removal) power the Inspector's
'Split at shots' and 'Remove silences' actions with the durable
transcript's speech shown per shot. Both are ordinary undoable,
replay-deterministic cuts, verified by 5 media + 7 core tests and
clicked end to end in the desktop Playwright check.
`runners/rmbg` is the fifth verified integration: IS-Net general use
(DIS, Apache-2.0) for `media.background_remove` - the official
isnet-general-use.onnx through the artifact store, an isolated uv
runtime (onnxruntime, CPU), and background removal through the runner
protocol verified on a real 1080x1920 face frame (subject alpha 0.81
vs 0.0005 in the background corners, ~1.0s); the adapter matches
upstream rembg's DisSession preprocessing and never downloads at
runtime; registry entry `gh/danielgatis/rembg-isnet-general-use` is
`verified` with dated evidence and a re-runnable verify script
(real face frame or deterministic synthetic fixture + objective alpha
statistics). RMBG-2.0 remains honestly unverified (license noted).
Background removal is live in the editing workflow: the Inspector's AI
actions offer 'Remove background' for selected IMAGE clips (desktop),
running media.background_remove through the bridge - the cutout lands
as a provenance-carrying image asset on a new 'Cutout' track at the
source clip's start (original intact; per-frame video matting is
documented future work). Desktop imports now keep the probe's kind, so
stills import as `image` assets, and stills have no intrinsic
duration (image clips may be held for any length - core invariant +
checkSourceFits updated, regression-tested); the jobs verification runs the
capability through the GenerationRunner end to end (subject alpha 0.995
vs 0.000 background; the cutout lands in the saved project as a
generated image asset with provenance); the desktop Playwright check
finds the still as the only clip offering the affordance with a live
button, and `OVM_CHECK_RMBG=1` clicks through the REAL job (Inspector
done state, Job Center entry, cutout asset + new track). The app has a
real icon: a graphite tile with film-strip tracks, the accent play
triangle and a timeline playhead (single SVG source in
`apps/desktop/build/icon.svg`; `scripts/generate-icons.mjs` renders the
1024px PNG + 256px .ico; electron-builder wires it for the Windows exe,
the NSIS installer/uninstaller, macOS and Linux, and the dev window).
Verified against the PACKAGED exe by `scripts/icon-check.mjs` (shell
icon matches the source PNG; graphite corners + accent-blue play area).
Media intelligence Level 3 ships as the honest lexical subset:
`@openvideomaker/media/topics` (pure; latin words minus stopwords +
CJK bigrams; TF-ranked keywords with segment timestamps; token-overlap
search with a substring fallback) powers the Transcript panel's search
box (ranked hits seek the playhead) and per-transcript keyword chips;
entity extraction and embedding search are NOT claimed - they need
models, and the scorers stay swappable. Verified: 6 media tests and
the desktop check (searching the demo transcript for 'videos' seeks
00:00:02:00; keyword chips render; zero errors). Product templates
land in core: `PROJECT_TEMPLATES` + `applyProjectTemplate` (Talking
Video, Auto Dub, Podcast Clips, Vertical Short, Blank) apply settings,
named tracks and script documents through the standard typed ops in
one undoable, replay-deterministic transaction ('blank' replaces the
sequence's tracks, undoably), and the Studio Templates panel shows the
five presets with a real apply button - templates are ordinary
editable structures, never locked modes (5 core tests + desktop-check
click-through: Vertical Short adds exactly two tracks). The Device
Center gained storage management: `ovm:storage` walks ONLY
OVM-managed directories (per-model manifest sizes, runtimes, generated
outputs, interrupted downloads, total) and `ovm:storage-clean` removes
resumable .part files and nothing else - models and generated outputs
stay untouched (desktop-check verified: real 1.4 GB of partials
cleared to 0 B, the button disables when empty, zero errors).
`runners/upscale` is the sixth verified integration: Real-ESRGAN
x4plus (RRDBNet, BSD-3-Clause) for `video.upscale` - official weights
through the artifact store, an isolated uv runtime (torch only; the
RRDBNet architecture reproduced from upstream with attribution since
basicsr is stale against current torchvision), and 4x upscaling via
the runner protocol verified on a downscaled 1080x1920 face frame
(1080x1920 output in ~14.2s CPU; Laplacian sharpness 70.1 vs 10.5 for
bicubic, edge energy 3.85 vs reference 3.69; PSNR deliberately not
claimed for a GAN restoration model). Registry entry
`gh/xinntao/Real-ESRGAN-x4plus` is `verified` with dated evidence.
The Studio has a Home view (top-bar Home button): 'What do you want
to make?' with the five template quick starts, Import media, Continue
editing, and a real Recent projects list - the main process persists
`recents.json` in the OVM home on every save/open (deduped, newest
first) and exposes `ovm:recents` + `ovm:open-project-dir` (a recents
entry has the same trust as a fresh dialog choice); the home
re-fetches recents on open, loads recents through the same
loadProject path as the open dialog, and opening a recent only
light-refreshes (no heavy device/storage re-probes - the storage walk
over a large torch venv proved slow enough to matter). Verified in
the desktop check: the just-saved project appears, clicking it closes
home and loads the saved state, and a template quick start adds its
two tracks and returns to the editor. Reframe-to-vertical lands as
one core command: `reframeToVertical` sets the project composition
and center-crops every media clip (16:9 -> 1080x1920 crops ~34% per
side) through ordinary typed `clip.crop` ops in one undoable,
replay-deterministic transaction, so every result stays editable and
re-reframable; the Studio Templates panel gains a 'Reframe to
vertical' card and the status bar reads the live composition (WxH @
fps). Verified three ways: 3 core tests, the re-runnable
`scripts/reframe-check.mjs` (reframes a 16:9 project and REALLY
renders it - ffprobe confirms 1080x1920; the render pipeline applies
the crop), and the desktop check (after the card click the status bar reads
1080x1920). Crop is now first-class in the editing workflow: the
preview stage frames the cropped region exactly like the render
pipeline (a fitted-source crop viewport driven by the same clip.crop
fractions the render plan turns into crop filters), stills preview
as images (image clips were invisible in the preview before), the
Inspector has a four-slider crop editor with per-side clamping plus
a one-click reset, and core rejects exhausted crops (left+right or
top+bottom >= 1) via the clip.crop-exhausted invariant. Verified:
2 new core tests and the desktop check (Inspector edit 34 -> 45,
preview viewport follows, reset clears it, Ctrl+Z restores it, the
imported still previews as an image). The 'Create a short' agent flow
is real: `@openvideomaker/media/highlights` (pure, model-free) ranks
Level-2 classified shots by speech/motion/spoken words and picks
spread, duration-capped highlight ranges, and
`@openvideomaker/agent` buildShortEditScript/buildShortProposal turn
them into a declarative EditScript (a new Highlights video track,
back-to-back inserts at real source inPoints, captions that keep
true transcript timing). The Studio Agent panel's 'Create a short
from this clip' card (15/30/60s) is honestly hidden unless the
selected clip has shot analysis, and the proposal uses the same
preview/apply (one undoable transaction)/reject pipeline as every
agent edit - the source timeline is never modified. Verified: 7
media + 4 agent tests and the desktop check (proposal 'Create a
3.0s short...', apply adds the Highlights track + 2 spread clips).
Next: code signing, auto-update, macOS/Linux packaging runs, media
intelligence Level 4, and further verified runners.
See `docs/STATUS.md`.
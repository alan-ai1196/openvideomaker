# OpenVideoMaker — current status

Updated: 2026-08-14 (round 9). This file is the single living status source; it
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
- Docs: AGENTS.md, README, architecture docs, ADRs 0001-0009, UX
  principles, SECURITY/CONTRIBUTING/notices.

## Next (in planned order)

1. More verified runner integrations (lip-sync/avatars next).
2. Characters/avatars; transcript & media intelligence; agent editing.
3. MCP server, SDK, CLI (`ovm`).
4. Model/Device/Job Centers; website (Astro + Cloudflare); Electron
   packaging; long-project performance hardening.

## Known environment notes

- Vitest 4 on Node ≥ 23.6 requires `--no-experimental-strip-types`; the
  package test scripts handle this via `scripts/vitest.mjs`.
- Cloudflare Wrangler is authenticated (workers/pages write); the site
  deployment step is still to come.
- Dev machine: Windows, RTX 3090 24GB — CUDA is a first-class target;
  MLX/ROCm remain unverified until real hardware evidence exists.
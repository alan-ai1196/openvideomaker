# OpenVideoMaker — current status

Updated: 2026-08-13 (round 5). This file is the single living status source; it
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
- Docs: AGENTS.md, README, architecture docs, ADRs 0001-0008, UX
  principles, SECURITY/CONTRIBUTING/notices.

## Next (in planned order)

1. Runner protocol + isolation; representative real AI integrations.
2. Device graph + hardware detection.
3. Characters/avatars; transcript & media intelligence; agent editing.
4. MCP server, SDK, CLI (`ovm`).
5. Model/Device/Job Centers; website (Astro + Cloudflare); Electron
   packaging; long-project performance hardening.

## Known environment notes

- Vitest 4 on Node ≥ 23.6 requires `--no-experimental-strip-types`; the
  package test scripts handle this via `scripts/vitest.mjs`.
- Cloudflare Wrangler is authenticated (workers/pages write); the site
  deployment step is still to come.
- Dev machine: Windows, RTX 3090 24GB — CUDA is a first-class target;
  MLX/ROCm remain unverified until real hardware evidence exists.
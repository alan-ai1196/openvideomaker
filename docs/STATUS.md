# OpenVideoMaker — current status

Updated: 2026-08-13 (round 2). This file is the single living status source; it
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
- Docs: AGENTS.md, README, architecture docs, ADRs 0001-0005, UX
  principles, SECURITY/CONTRIBUTING/notices.

## Next (in planned order)

1. Preview/timeline vertical slice: real media import (ffprobe),
   thumbnails, waveforms, canvas preview playback, ripple edits.
2. Export slice: render plan → FFmpeg, encoder detection, jobs.
3. Model registry + providers (HF/ModelScope/mirror) + download store.
4. Runner protocol + isolation; representative real AI integrations.
5. Characters/avatars; transcript & media intelligence; agent editing.
6. MCP server, SDK, CLI (`ovm`).
7. Model/Device/Job Centers; website (Astro + Cloudflare); Electron
   packaging; long-project performance hardening.

## Known environment notes

- Vitest 4 on Node ≥ 23.6 requires `--no-experimental-strip-types`; the
  package test scripts handle this via `scripts/vitest.mjs`.
- Cloudflare Wrangler is authenticated (workers/pages write); the site
  deployment step is still to come.
- Dev machine: Windows, RTX 3090 24GB — CUDA is a first-class target;
  MLX/ROCm remain unverified until real hardware evidence exists.
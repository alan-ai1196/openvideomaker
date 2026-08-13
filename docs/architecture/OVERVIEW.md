# Architecture Overview

Status: matches current code (foundation stage).

## The one invariant that shapes everything

OpenVideoMaker has **one product model with many interfaces**. Studio,
MCP, SDK, CLI and agents all mutate projects through the same typed
operation layer; none of them re-implements business logic.

```
Human UI ──┐
MCP ───────┼─→ Command/Operation layer (packages/core) ─→ Project state
SDK ───────┤        typed ops · transactions · invariants · history
CLI ───────┘
```

## Current package graph

```
packages/schema   Video IR: durable zod schemas for projects, timelines,
                  assets, characters, transcripts, provenance,
                  operations, history. Depends on: zod.

packages/core     Authoritative operation engine: ProjectSession (apply,
                  transaction, undo/redo, replay), per-domain apply
                  functions, project invariants, builders, commands
                  (ripple/split/insert, captions-from-transcript),
                  errors. Depends on: @openvideomaker/schema.

packages/persistence
                  Durable project store: SQLite snapshot + append-only
                  operation log, crash-safe saves, corruption repair,
                  relocation-safe project folders.
                  Depends on: schema, core, better-sqlite3.

apps/site         The public marketing + docs site (Astro, static)
                  deployed to openvideomaker.heartboat.me as a
                  Cloudflare Workers static-assets project.

apps/studio       The primary React editor: design tokens, shell layout
                  (top bar, media/asset panels, preview stage, inspector,
                  timeline), real editing interactions driven through the
                  core operation layer. Depends on: schema, core.

packages/media    Node media indexing (desktop/server): ffprobe probing,
                  ffmpeg thumbnails and waveforms. The Studio has
                  browser-native equivalents behind the same schemas.
                  Depends on: schema.

packages/render   Authoritative final rendering: render plans from the
                  Video IR, probed encoders with hardware fallback,
                  RenderJobs (progress/cancel/logs), ovm-render CLI.
                  Depends on: schema, core, media.

packages/registry Machine-validated model registry: capability catalog,
                  trust states, HF/ModelScope/mirror sources; generated
                  model docs. Depends on: zod.

packages/downloader
                  Content-addressed model artifact store: dual-hub
                  providers with priority profiles, resumable verified
                  downloads, revision manifests.
                  Depends on: registry.

packages/runners  Language-neutral NDJSON runner protocol over stdio,
                  crash-safe host, uv-isolated Python runtimes. Adapters
                  in runners/<name>; first verified: runners/kokoro-tts.
                  Depends on: zod.

packages/devices  Probed device graph: OS/CPU/memory, GPUs via
                  nvidia-smi, ffmpeg encoders (reusing render), toolchain
                  runtimes; ovm-doctor CLI. Absence is data, never an
                  error. Feeds the future Device Center.
                  Depends on: render, media, zod.

packages/jobs     Generation jobs: capability requests run through
                  registry + artifact store + uv runtime + runner
                  protocol (data-driven runner.json manifests), then
                  land in projects via core ops with full provenance.
                  Depends on: registry, downloader, runners, core,
                  media, schema, zod.

packages/agent    Agent editing: EditPlan/EditScript (restricted
                  declarative steps with $variable bindings, never
                  eval) compile to the standard typed operations;
                  scratch-copy previews; reviewable proposals.
                  Depends on: schema, core, zod.

packages/mcp      MCP server (spec 2025-06-18, stdio): semantic,
                  capability-first tools over the same operation
                  layer + project:// and model:// resources.
                  Depends on: schema, core, agent, registry, zod.

packages/cli      The ovm CLI: doctor / models / render / mcp,
                  delegating to the same packages as the Studio.
                  Depends on: devices, registry, render, mcp.
```

Dependency direction is strict: `schema ← core ← everything else`.
Future packages (ui, mcp, sdk, cli, persistence, jobs, registry, ...)
stack on top of core and may never be imported by it.

## Planned surfaces (sequencing, not scope reduction)

1. Studio shell + design system (React/Vite).
3. Preview/timeline vertical slice (WebCodecs/WebGPU, virtualized).
4. Import/edit/export vertical slice (FFmpeg render plan).
5. Jobs/devices/render system.
6. Model registry + source/download system (HF, ModelScope, mirrors).
7. Runner protocol + isolation (language-neutral, framed stdio).
8. Character/avatar flows; transcript/media intelligence.
9. Agent/EditPlan/EditScript; MCP/SDK/CLI.
10. Model/Device/Job Center polish; website/docs; packaging.

## Toolchain decisions (verify before changing)

- Node ≥ 22.12 (dev on 24 LTS), pnpm 10 workspaces, Turbo build graph.
- TypeScript 7 (native compiler) — type-check/build only; Vite/Vitest
  handle transpilation.
- ESM everywhere (`"type": "module"`).
- Vitest 4 with `scripts/vitest.mjs` launcher (see AGENTS.md for the
  Node-24 native-TS caveat).
- Zod 4 at every durable/untrusted boundary.
- Apache-2.0 for project code; third-party model licenses stay separate.
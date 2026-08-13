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
                  assets, characters, provenance, operations, history.
                  Depends on: zod.

packages/core     Authoritative operation engine: ProjectSession (apply,
                  transaction, undo/redo, replay), per-domain apply
                  functions, project invariants, builders, errors.
                  Depends on: @openvideomaker/schema.
```

Dependency direction is strict: `schema ← core ← everything else`.
Future packages (ui, mcp, sdk, cli, persistence, jobs, registry, ...)
stack on top of core and may never be imported by it.

## Planned surfaces (sequencing, not scope reduction)

1. Persistence (SQLite-backed project store, migration framework).
2. Studio shell + design system (React/Vite).
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
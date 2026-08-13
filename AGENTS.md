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
and typed operation vocabulary) and `@openvideomaker/core` (operation
engine: transactions, undo/redo, replay, concurrency, invariants). Next:
persistence, Studio shell, preview/timeline slice, jobs/devices/render,
registry and runner protocol. See `docs/STATUS.md`.
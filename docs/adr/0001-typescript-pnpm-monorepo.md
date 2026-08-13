# ADR-0001: TypeScript ESM pnpm monorepo for the whole product

## Context

OpenVideoMaker spans a React Studio, an Electron desktop shell, a
TypeScript core, isolated model runners, MCP/SDK/CLI interfaces and a
static site. A single application must share one project model across all
surfaces, and the core must remain importable from Electron main, Node
services, tests and the browser build graph.

## Decision

- One pnpm workspace monorepo; Turbo for the build graph.
- Everything user-facing in TypeScript, ESM (`"type": "module"`),
  strict mode, bundled-style module resolution.
- Core language stack: Node ≥ 22.12, pnpm ≥ 10, TypeScript 7 (native
  compiler) for type-check/build; Vite/Vitest own transpilation.
- Zod at every durable/untrusted boundary; plain typed interfaces inside
  trusted same-process code.

## Consequences

- Cross-package dependency direction is enforceable via workspace
  dependencies and is documented in AGENTS.md.
- Electron main, Node CLI and browser builds share the same compiled
  core; no duplicated business logic can survive review.
- TypeScript 7 (tsgo) is the native compiler; type-checking is separate
  from bundling, so Vite/Rolldown evolution does not block the core.

## Alternatives considered

- Per-surface repositories: rejected — would fork the project model.
- JavaScript-only core: rejected — typed ops are the product's contract.
- Nx/Bazel: rejected — Turbo is sufficient for this graph size and adds
  far less ceremony.
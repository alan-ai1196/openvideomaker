# ADR-0002: Typed operation log as the authoritative project state

## Context

The product requires undo/redo, version history, agent proposals with
reviewable diffs, crash recovery, deterministic replay, and future
collaboration — while Studio, MCP, SDK, CLI and agents must all mutate
projects through one implementation.

## Decision

- The project state is derived from an append-only log of typed
  **transactions**, each containing one or more **operations**
  (`clip.insert`, `clip.trim`, `generation.create`, ...).
- Sessions apply transactions atomically onto a draft and run
  deterministic invariant checks before commit.
- Optimistic concurrency uses an operation **checkpoint** as the base
  version; stale writers are rejected with a ConflictError.
- Undo/redo move the checkpoint per operation; replay rebuilds any
  historical state from the blank project.

## Consequences

- Every mutation is inspectable, attributable (actor kind + name), and
  reversible — the foundation for agent traceability.
- Agent proposals can be realized as dry-run transactions over a cloned
  session and diffed before apply.
- Replay cost is linear in history length; acceptable now, with snapshot
  caching a planned optimization for very large projects.

## Alternatives considered

- Mutating state + snapshot undo stack: rejected — cannot replay, cannot
  rebase, duplicates history semantics across surfaces.
- Command objects per UI action only: rejected — agents and MCP would
  then need their own mutation paths, violating the one-model invariant.
# Operations, transactions and history

**Project-changing means logged.** Every meaningful mutation is an
explicit typed operation; there is no other way to change a project.

## Operation vocabulary

~43 operation types in `packages/schema/src/operations.ts`, grouped by
domain: `project.*`, `sequence.*`, `track.*`, `clip.*`, `text.edit`,
`caption.edit`, `effect.*`, `transition.set`, `marker.*`, `asset.*`,
`character.*`, `voice.change`, `generation.*`. Each carries typed params
and an envelope (`opId`, `at`, `actor {user|agent|script}`).

```ts
session.transaction((tx) => {
  tx.insertClip({ sequenceId, trackId, clip });
  tx.trimClip({ sequenceId, clipId, duration: 2_000_000 });
});
```

## Apply pipeline (per transaction)

1. **Validate** raw ops against the operation schema (SchemaError).
2. **Checkpoint check** — reject stale `baseCheckpoint` (ConflictError).
3. **Apply** each op onto a draft clone; preconditions throw
   OperationError with machine-readable codes.
4. **Invariants** — deterministic whole-project checks (overlaps,
   dangling refs, source-fit, caption bounds, track-kind rules, ...);
   violations throw InvariantError listing every problem found.
5. **Commit** — freeze state, append transaction to the log, advance the
   checkpoint once per operation.

A mid-transaction failure rolls back everything: transactions are atomic.

## History and replay

- Undo/redo move a per-operation checkpoint; state is derived by
  deterministic replay from the blank project.
- `ProjectSession.fromLog(log)` reproduces any historical state — the
  foundation for crash recovery, agent proposals and review diffs.
- Applying after undo truncates the redo tail (standard NLE behavior).

## Concurrency

No global project lock. Writers name their base checkpoint; stale writers
fail loudly instead of silently overwriting newer state. Future
collaboration paths (rebase/merge) build on the same log.

## Why operations, not raw state writes

UI, MCP, SDK, CLI and agents share one implementation of `trim`, `split`,
`move`, `generation.create`, ... This is the architectural invariant that
keeps every interface honest and every agent edit reviewable.
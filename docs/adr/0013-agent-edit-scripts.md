# ADR-0013: Agent edits are declarative scripts, never evaluated code

## Context

The editing agent must batch many edits without eighty round trips,
but executing arbitrary model-generated TypeScript inside the trusted
core would be a security and correctness disaster. The Goal explicitly
forbids naive eval and requires the result to still be a typed
operation transaction.

## Decision

- Agent edits are expressed as EditScripts: a restricted declarative
  vocabulary (track.create, clip.insert/remove/move/trim, text/caption
  inserts) validated by zod, with `$variable` bindings for entities a
  script creates.
- `compileEditScript` resolves steps against the project plus the
  script's own bindings and emits the standard typed operations;
  nothing else is exposed (no filesystem, no network, no loops, no
  eval).
- Plans (intent/evidence/constraints) are separate artifacts from
  scripts; proposals pair them with a scratch-copy preview and apply
  as one undoable transaction with actor 'agent'.

## Consequences

- Any consumer (Studio panel, MCP, CLI) gets identical semantics for
  free, and every agent edit is reviewable/undoable like a human edit.
- If richer composition is ever needed, the DSL can grow step types
  without opening a code-execution path.
- Deterministic planners (today) and LLM planners (later) target the
  same contract.

## Alternatives considered

- Executing model-generated TypeScript in an isolated process:
  rejected for now - isolation is real work with high blast radius;
  revisit only if the declarative DSL provably cannot express needed
  edits.
- QuickJS/WASM sandbox: rejected - same concern, and the editing
  domain is finite enough for a typed DSL.

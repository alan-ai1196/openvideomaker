# ADR-0005: Studio architecture - one controller, one-way data flow over the core session

## Context

The Studio UI must never become a second implementation of business logic.
It needs real editing interactions (drag, trim, selection, playback) that
behave identically whether driven by mouse, keyboard, or - later - agents,
and it must render instantly when MCP or SDK code mutates the same project.

## Decision

- A UI-agnostic `StudioController` wraps exactly one `ProjectSession` and
  owns selection, playhead, playback clock, zoom, and error surfacing.
- Every user edit calls `controller.mutate(fn)`, which runs a typed
  `TransactionScope` against the core operation layer - the same path MCP,
  SDK and CLI use. Invalid edits (overlaps, out-of-source trims) are
  rejected by core invariants and surfaced as a toast, never as a crash.
- React binds through `useSyncExternalStore(controller.subscribe,
  controller.getSnapshot)`; the project object is frozen and immutable, so
  rendering is a pure function of the latest snapshot.
- Timeline interactions are pointer-based with local preview state; the
  authoritative mutation happens once, on commit.
- The browser build uses the platform crypto API for ids (no Node-only
  imports in the shared schema package).

## Consequences

- Undo/redo, replay and checkpoint semantics work identically in the UI
  and outside it; the UI adds no state model of its own.
- Agent-driven edits later will surface in the Studio without new
  plumbing: same session, same snapshot subscription.
- The controller is testable headlessly (Playwright drives it through a
  dev-only `window.__ovmStudio` handle).

## Alternatives considered

- Redux/Zustand store mirroring the project: rejected - a second source
  of truth that must be synced to the operation log.
- Mutating the session inside React render or state updaters: rejected -
  StrictMode double-invocation would double-apply operations.

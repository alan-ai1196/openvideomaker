# ADR-0016: Desktop is an Electron shell over the SAME Studio, with a narrow preload

## Context

The desktop app must add local powers (persistence, FFmpeg, model
installation, GPU jobs) without forking the product UI or exposing
Node primitives to renderer code.

## Decision

- `apps/desktop` is one Electron window around the SAME Studio build
  (dev server URL, or the built `apps/studio/dist` over file:// - the
  Studio builds with a relative asset base for exactly this).
- The renderer stays sandboxed: contextIsolation on, nodeIntegration
  off, and a NARROW CJS preload exposes a typed `window.ovm` bridge
  (capabilities, openProject, saveProject, runDoctor) - nothing else.
- Capability flags stay honest: localPersistence is true (SQLite
  project folders via `@openvideomaker/persistence`), localRender and
  localGeneration remain false until those IPC paths actually exist.
- The Studio treats the bridge as optional: absent in the browser,
  present in desktop; capability detection changes options, never
  semantics.

## Consequences

- One UI codebase; desktop-specific behavior lives in the main
  process and the Studio's thin bridge accessor.
- Render/generation IPC, model install and the local MCP server slot
  into the same bridge pattern in later slices.
- A smoke mode verifies main + persistence + device probing
  headlessly; Playwright's Electron driver verifies the real window.

## Alternatives considered

- A separate desktop UI: rejected - duplicates the Studio and breaks
  the one-product invariant.
- nodeIntegration in the renderer: rejected - unnecessary privilege.

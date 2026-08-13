# ADR-0003: Microsecond timeline with rational frame rates

## Context

Timeline editors must survive mixing 23.976, 24, 25, 29.97, 30, 50, 59.94
and 60 fps sources without accumulating rounding drift, and the same
project must reinterpret cleanly when the project frame rate changes.

## Decision

- Canonical timeline time is **integer microseconds** (µs); frame counts
  are only a derived display concern.
- The project timebase is a **rational fps** (`{ num, den }`, e.g.
  30000/1001), stored in project settings.
- `framesToUs` rounds to the nearest µs; `usToFrames` floors. Display
  frame rate/timecode are computed from the rational pair (non-drop-
  frame display; drop-frame is a UI-layer convention if ever needed).

## Consequences

- A 24 h timeline fits far below `Number.MAX_SAFE_INTEGER` µs; integer
  comparisons are exact, so overlap/sort logic has no epsilon hacks.
- Speed changes consume source in µs (`duration × speed`), checked
  against probed asset duration.
- Conversions centralize in `packages/schema/src/time.ts`; callers never
  hand-roll frame math.

## Alternatives considered

- Float seconds: rejected — binary rounding drift at 29.97 breaks exact
  overlap checks.
- Fixed frame grid: rejected — couples the project to one frame rate and
  complicates mixed-rate sources.
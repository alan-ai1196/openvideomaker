# ADR-0004: SQLite project store with snapshot + operation log

## Context

Projects must persist across sessions on Windows/macOS/Linux, survive
crashes, open quickly for large projects, be portable (rename/move/copy/
archive), and keep full edit history for undo, review and agent
traceability.

## Decision

- A project is a folder (`<name>.ovm/`): `meta.json` (identity/manifest),
  `store.sqlite` (structured state), and `assets/ proxies/ generated/
  `cache/` directories for binary media.
- SQLite (better-sqlite3) stores two things: an optional **snapshot**
  (fast-load cache of the full project JSON at a revision) and the
  complete append-only **transaction log** (the authoritative truth).
- Saves append only the new log tail inside one SQLite transaction
  (crash-safe); snapshots refresh every N operations as a cache.
- Loads replay the log tail over the snapshot and re-verify project
  invariants — torn or corrupt snapshots rebuild from the full log.
- Binary media stays on the filesystem; the database never holds blobs.

## Consequences

- History is preserved indefinitely by default; `compact()` is an
  explicit opt-in that trades history for size.
- Cross-process safety relies on SQLite locking (WAL + busy timeout);
  multi-process writers must still serialize through the store API.
- Relocation is free: everything is relative to the folder.

## Alternatives considered

- JSON files only: rejected — no atomic multi-file updates, no cheap
  incremental append, torn writes corrupt projects.
- LevelDB/LMDB: rejected — SQLite is battle-tested, readable with
  standard tools, and sufficient for structured state of this size.
- node:sqlite: rejected for now — still experimental on Node 24;
  better-sqlite3 has stable prebuilds across Node/Electron. The store
  API keeps the engine swappable.
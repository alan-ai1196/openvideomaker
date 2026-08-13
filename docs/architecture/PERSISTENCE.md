# Persistence

Status: matches current code.

## Project folder layout

```
My Video.ovm/
  meta.json       identity manifest (project id, format version)
  store.sqlite    snapshot + append-only operation log (durable truth)
  assets/         source media as files
  proxies/        preview proxies
  generated/      AI-generated artifacts
  cache/          expendable caches
```

Binary media lives on the filesystem; SQLite holds structured state only.
Everything is relative — projects are portable by copy/move/archive.
Absolute paths are never identity.

## Store semantics (`@openvideomaker/persistence`)

- `ProjectStore.create/open(dir)` — create or open a project folder;
  `meta.json` carries `formatVersion` (currently 1) for migrations.
- `save(project, log)` — validates both against schemas, verifies the
  stored log is a **prefix** of the incoming log (history can only
  append; divergence is a hard error), then atomically appends the tail
  and refreshes the snapshot cache.
- `load()` — snapshot + replay of the log tail, then full invariant
  verification. Corrupt snapshots are rebuilt from the log; corrupt
  logs fail loudly with typed `StoreError`s.
- `compact()` — explicit opt-in: fold the log into the snapshot and
  drop history (e.g. for archival).
- Crash safety: WAL journaling, one SQLite transaction per save,
  `busy_timeout` for concurrent access.

## Failure model

Every failure is a typed `StoreError` (or core SchemaError/InvariantError)
with a stable code: `store.version`, `store.corrupt`, `store.diverged`,
`store.busy`, `store.empty`, `store.not-a-project`. No silent repairs,
no silent downgrades.

## Migrations

`meta.json` formatVersion and the store `schema_version` row are the
migration anchors. Pre-release, correcting fundamental mistakes beats
preserving bad internal compatibility; public-format compatibility
begins when the format stabilizes.
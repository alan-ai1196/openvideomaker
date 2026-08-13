# Video IR — the durable project model

The most important product abstraction is not a React timeline component;
it is the durable, versioned, editable **Video IR** defined by
`@openvideomaker/schema`.

## Canonical time

All timeline positions and durations are **integer microseconds**. Frame
counts are only a derived display concern computed from the project
timebase, a rational fps (`{ num, den }`, e.g. 30000/1001 for 29.97). The
same project reinterprets cleanly at 24/25/30/23.976/29.97/60 fps. See
ADR-0003.

## Entities

- **Project** — id, name, settings (frame size, rational fps, sample
  rate), assets, characters, sequences, activeSequenceId, formatVersion.
- **Sequence** — ordered tracks + markers.
- **Track** — kind (`video|audio|text|caption|overlay`), enable/mute/lock,
  ordered non-overlapping clips (order/overlap enforced by core
  invariants, not the schema).
- **Clip** — discriminated by kind:
  - `media` — assetId + inPoint (source offset), speed;
  - `text` — content + style;
  - `caption` — timed segments (clip-relative);
  - `color` — solid background.
  All clips share: timeline start/duration, speed, enable, opacity,
  transform, crop, audio (gain/mute/fades), effects+keyframes,
  transitions, linkedClipId, and optional generation provenance.
- **Asset** — kind, name, source (`file|cas|remote`), probed media info,
  origin (`import|recorded|generated`), optional proxy link.
- **Character** — identity (reference images/video), voice config with
  consent metadata, performance defaults. Reusable across scenes.
- **Script** — ordered speech lines optionally linked to characters,
  with optional timeline placement; edited as typed operations and
  synced to a text track in one reviewable step.
- **Transcript** — time-aligned segments linked one-to-one to an asset,
  with ASR/import/manual sources.
- **Marker** — timeline position + note/color.
- **GenerationProvenance** — capability, model+revision, runner, settings
  snapshot, inputs, device, regeneration info. Generated clips are never
  anonymous files.

## Identity

IDs are opaque prefixed strings (`asset_…`, `clip_…`, `trk_…`, `seq_…`,
`char_…`, `op_…`, `tx_…`, `mkr_…`, `fx_…`). The prefix is self-
describing and stable; absolute paths are never long-term identity.

## Schema versioning

`ProjectSchema.formatVersion` is the durable format version; it changes
only with explicit migrations. Pre-release, we prefer correcting
fundamental schema mistakes over preserving bad internal compatibility.
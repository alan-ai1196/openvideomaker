# OpenVideoMaker

**Make videos with AI. Keep everything editable.**

OpenVideoMaker is an open-source video creation application for ordinary
creators as well as developers and agents. It pairs a real editable
timeline with AI capabilities — captions, dubbing, avatars, lip sync,
B-roll, reframing, cleanup, generative media — so that every AI result
stays a normal, editable part of your project instead of a dead-end file.

> **Status: pre-alpha.** The Studio (editable timeline, transcripts,
> characters, agent proposals), three verified local AI integrations
> (Kokoro TTS, Whisper and Paraformer ASR), generation jobs with
> provenance, an MCP server and the `ovm` CLI are implemented and
> tested. The public site is live at
> [openvideomaker.heartboat.me](https://openvideomaker.heartboat.me).
> See `docs/STATUS.md` for the current truth.

## What exists today

- **Video IR** (`@openvideomaker/schema`) — a durable, versioned project
  model: projects, sequences, tracks, clips, assets, characters, captions,
  effects, transitions, markers, and AI provenance. Validated with Zod.
- **Operation engine** (`@openvideomaker/core`) — the single authoritative
  path for every project change, shared by UI, MCP, SDK, CLI and agents:
  typed operations, transactions, undo/redo, deterministic replay,
  optimistic concurrency, and structural invariants.
- **Project persistence** (`@openvideomaker/persistence`) — portable
  SQLite project folders with crash-safe saves and full edit history.
- **Studio** (`apps/studio`) — the React editor: graphite dark/light
  design system, editable timeline (move, trim, zoom), inspector,
  undo/redo, shortcuts, English + Simplified Chinese.
- **Media pipeline** (`@openvideomaker/media`) — ffprobe probing,
  thumbnails, waveform peaks for the desktop/server side.
- **Rendering** (`@openvideomaker/render`) — render plans from the Video
  IR, probed encoders with hardware-to-software fallback, RenderJobs,
  `ovm-render` CLI.
- **Model registry + store** (`@openvideomaker/registry`,
  `@openvideomaker/downloader`) — capability-first model catalog with
  honest trust states, and content-addressed, resumable, verified
  downloads.
- **Runner protocol** (`@openvideomaker/runners`) — language-neutral
  NDJSON runners in uv-isolated runtimes; first verified integration:
  Kokoro TTS.
- **Device graph** (`@openvideomaker/devices`) — probed hardware facts
  (CPU/GPU/encoders/runtimes) via the `ovm-doctor` CLI.
- **Generation jobs** (`@openvideomaker/jobs`) — capability requests
  run through the registry, artifact store and isolated runners, then
  land in projects as editable assets with full provenance.
- **Agent editing** (`@openvideomaker/agent`) — EditPlan/EditScript
  proposals compiled to the same typed operations as manual edits.
- **MCP + CLI** (`@openvideomaker/mcp`, `@openvideomaker/cli`) — a
  semantic agent tool surface over the operation layer and the `ovm`
  command (doctor / models / render / mcp).

## Quick start (developers)

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @openvideomaker/studio dev   # run Studio
```

Requires Node >= 22.12 and pnpm >= 10. Studio runs at
`http://localhost:5183`. See `AGENTS.md` for repository
invariants and `CONTRIBUTING.md` for contribution guidance.

## Product surfaces (planned)

- **Studio** — the primary React editing app (browser + desktop).
- **Desktop** — Electron shell with local FFmpeg, AI runtimes, model
  installation, and native media access.
- **Core** — TypeScript project/operation/job semantics (foundation done).
- **MCP server + SDK/CLI** — agent and developer interfaces over the same
  operation layer.
- **Website/docs** — `openvideomaker.heartboat.me`.

## Hardware

OpenVideoMaker targets heterogeneous hardware: ordinary laptops edit
locally; NVIDIA GPUs, Apple Silicon (MLX), ROCm and remote workers run
models where they fit best. Projects are hardware-independent — a project
edited on a laptop opens unchanged on a workstation.

## License

OpenVideoMaker is Apache-2.0 licensed. Model weights and third-party
runners carry their own licenses; the project never implies a model is
commercially usable merely because OpenVideoMaker is permissively
licensed.
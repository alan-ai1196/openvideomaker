# OpenVideoMaker

**Make videos with AI. Keep everything editable.**

OpenVideoMaker is an open-source video creation application for ordinary
creators as well as developers and agents. It pairs a real editable
timeline with AI capabilities — captions, dubbing, avatars, lip sync,
B-roll, reframing, cleanup, generative media — so that every AI result
stays a normal, editable part of your project instead of a dead-end file.

> **Status: pre-alpha, foundation stage.** The core project model and
> operation engine are implemented and tested; the Studio UI, model
> integrations, and packaging are being built. See `docs/STATUS.md` for
> the current truth instead of guessing from this README.

## What exists today

- **Video IR** (`@openvideomaker/schema`) — a durable, versioned project
  model: projects, sequences, tracks, clips, assets, characters, captions,
  effects, transitions, markers, and AI provenance. Validated with Zod.
- **Operation engine** (`@openvideomaker/core`) — the single authoritative
  path for every project change, shared by UI, MCP, SDK, CLI and agents:
  typed operations, transactions, undo/redo, deterministic replay,
  optimistic concurrency, and structural invariants.

## Quick start (developers)

```bash
pnpm install
pnpm build
pnpm test
```

Requires Node ≥ 22.12 and pnpm ≥ 10. See `AGENTS.md` for repository
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
# ADR-0009: Language-neutral runner protocol with uv-isolated runtimes

## Context

Model inference must live in isolated external processes that speak one
contract regardless of language (Python, MLX, native, remote), a crashed
runner must never crash the editor, and runtime installation must never
touch the user's global Python environment.

## Decision

- One NDJSON-over-stdio protocol (`@openvideomaker/runners`): describe /
  prepare / execute / progress / cancel / health / dispose, with correlated
  request ids, zod-validated messages, and file references for all binary
  media - weights and media never travel inside JSON.
- The host side (`RunnerHost`) owns correlation, timeouts, bounded log
  capture, cancellation and crash isolation: a dead runner fails only its
  pending job.
- Python runtimes are created with uv into an OpenVideoMaker-managed
  directory (`UvRuntime`), from pinned requirement manifests per runner.
- Adapters are first-party code in `runners/<name>/` implementing the
  protocol; the first verified one is `runners/kokoro-tts` (Kokoro-82M).

## Consequences

- Adding a model = registry metadata + an adapter + verification; Studio,
  MCP and CLI never change.
- The runner process boundary is also the security boundary: adapters get
  explicit file paths, never ambient filesystem/network access.
- Remote workers can reuse the same message shapes over a transport later.

## Alternatives considered

- Direct library imports into core: rejected - no isolation, and Python
  models cannot be loaded from TypeScript anyway.
- MCP as the runner protocol: rejected - runner communication is
  host-internal and simpler; MCP is the external agent boundary.

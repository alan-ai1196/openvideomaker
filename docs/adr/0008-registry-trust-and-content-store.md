# ADR-0008: Registry trust states, dual-hub providers and the content-addressed store

## Context

The product must support many external models without owning their
implementations, must serve both Hugging Face and ModelScope users as
first-class citizens, and must never let a download imply executing
downloaded code - all while the registry remains the single source of
model truth.

## Decision

- A version-controlled, zod-validated registry (`@openvideomaker/registry`)
  with an explicit **trust state** per entry (core/verified/community/
  experimental/unverified). All current entries are `unverified` and say
  exactly what evidence exists (hub API metadata, no execution).
- Artifact sources are per-entry and explicit (HF repo / ModelScope id /
  http mirror); **priority profiles** (global, mainland-china, auto,
  custom) order them, with HF_ENDPOINT honored as the configured mirror.
  Mirrors are configuration, never baked-in fallbacks.
- Downloads land in a **content-addressed store** (sha256), revisions are
  pinned by manifests, and installs require a verified file manifest -
  resumable, cancellable, integrity-checked.
- `docs/models.md` is generated from the registry and drift-checked in
  tests.

## Consequences

- Adding a model = registry metadata (+ file manifest when verified); no
  UI/core/schema changes.
- The same registry feeds Studio, future MCP tooling and docs with zero
  duplication.
- Downloads are safe-but-dumb by design: no archive extraction, no code
  execution, sanitized paths, bounded retries.

## Alternatives considered

- Hardcoded model lists in the UI: rejected - three inconsistent copies
  and model-specific conditions would leak everywhere.
- Hub SDKs (@huggingface/hub, modelscope): rejected for now - plain HTTP
  resolution keeps the downloader auditable, dependency-light and
  mirror-friendly.

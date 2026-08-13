# Model runtime: registry, providers and the artifact store

Status: matches current code.

## Capability-first

Upper layers (Studio, MCP, agents) ask for capabilities
(`avatar.lip_sync`, `audio.tts`, ...) - never model names. The
capability catalog in `@openvideomaker/registry` owns the input/output
contracts; registry entries declare which capabilities they implement.

## The registry

`@openvideomaker/registry` is version-controlled, machine-validated
metadata (zod) under `packages/registry/src/data`. Each entry records:

- stable id (`hf/<owner>/<repo>` or `ms/<org>/<name>`), category,
  capabilities, runner kind, per-platform hardware status,
  license (id/name/url/note), artifact sources (HF + ModelScope + http
  mirrors, explicitly equivalent), limitations, and an evidence sentence.
- **Trust states** describe evidence: core / verified / community /
  experimental / unverified. Every current entry is `unverified` -
  metadata was checked against the hub APIs at research time, but no
  runner has executed any model yet. That is the honest truth and stays
  so until the runner slice verifies each integration.
- `docs/models.md` is GENERATED from the registry and drift-checked in
  tests; there is no second manual list.

## Providers

Both hubs are first-class: HF resolves via
`https://huggingface.co/<repo>/resolve/<rev>/<file>` (with the
HF_ENDPOINT environment mirror honored for mainland-China profiles),
ModelScope via its repo API. Sources order by profile: Global prefers HF,
Mainland China prefers ModelScope. Mirrors are configuration, never
hardcoded fallbacks baked into product code.

## The artifact store

`@openvideomaker/downloader` stores files content-addressed by sha256
(identical bytes from any source dedupe to one file) and pins each model
revision with a manifest. Downloads are resumable (Range), cancellable,
progress-reporting, disk-space-checked, and integrity-verified whenever
the registry provides a sha256. Entries without a verified file manifest
refuse to install loudly - guessing is how supply chains break.

## Security boundary

The store never executes anything: downloading artifacts never runs
repository code. Paths are sanitized (no traversal, no absolute paths),
and file manifests come only from the reviewed registry. Runner code is a
separate concern (first-party adapters, isolated runtimes) - see
`SECURITY.md`.

## Model Center UX

Studio's AI panel browses by category with capability summaries, trust
badges, license notes and evidence lines. Install buttons exist but are
honestly disabled in browser mode: installation runs in the desktop app.

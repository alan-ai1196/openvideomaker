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
  experimental / unverified. Entries start `unverified` (metadata
  checked against the hub APIs at research time) and flip to `verified`
  only with real execution evidence; currently verified: Kokoro TTS
  (`hf/hexgrad/Kokoro-82M`) and Whisper Large v3
  (`hf/openai/whisper-large-v3`), both with dated evidence sentences.
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

Hash sourcing for HF manifests: the tree API `oid` for non-LFS files is
a git blob id, not a content hash - never seed it. LFS files expose
their content sha256 under `lfs.oid`; small files are measured directly
from an official download before they are pinned. Registry entries
record only measured content hashes. Because
the store is a flat hash-named CAS, adapters materialize the canonical
layout they need from the file refs they receive (kokoro copies the
voice to `voice.pt`; whisper assembles the five CTranslate2 files into a
model directory) - the store layout never leaks into runners.

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
## Runner protocol and isolation

`@openvideomaker/runners` defines a language-neutral NDJSON protocol over
stdio: describe / prepare / execute / progress / cancel / health /
dispose, with correlated ids, zod-validated messages, and file references
for all binary media. `RunnerHost` owns correlation, timeouts, bounded
logs and crash isolation - a dead runner fails only its pending job.
Python runtimes are uv-managed under an OpenVideoMaker-owned directory
from pinned manifests, never the global Python. Adapters live in
`runners/<name>/` and are first-party code; verified integrations are
`runners/kokoro-tts` (TTS) and `runners/whisper-asr` (transcription with
timed segments + SRT captions), each with a re-runnable `verify.mjs`.
On top sits `@openvideomaker/jobs`: generation runs resolve adapters
from `runners/<name>/runner.json` manifests and land outputs in projects
through the operation layer with full provenance (see ADR-0011).

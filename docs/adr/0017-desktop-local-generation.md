# ADR-0017: Desktop local generation and the ovm-media protocol

## Context

The desktop app needed real local AI generation (TTS/ASR and, later,
lip-sync/avatars) and a way for the sandboxed renderer to PLAY the
local media it imports and generates. Both had to preserve the
invariants: one operation layer, narrow renderer privileges, honest
capability flags, and no model-specific code outside the registry/
runner boundary.

## Decision

- The main process hosts `DesktopGenerationService`, a thin wrapper
  over `@openvideomaker/jobs`' `GenerationRunner` - the SAME runner
  the SDK/CLI use (registry data + content-addressed model store +
  uv-isolated runtimes + the NDJSON runner protocol). The renderer
  never imports runners or models.
- `ovm:generate` IPC accepts a validated capability-first request
  (capability, modelId, settings, inputs, modelInputs, device,
  provenanceInputs - zod at the boundary). `modelInputs` resolve
  model-owned files (e.g. a TTS voice) against the store revision,
  so callers never hardcode weight paths.
- Progress streams over `ovm:generate-progress` events (state/stage/
  progress/bytes); `ovm:generate-cancel` cancels the job.
- Results land in the project ONLY through the typed operation layer:
  the renderer builds assets with the core `generatedAsset` builder
  and imports them via `tx.importAsset`; ASR transcripts attach via
  the shared core command `attachAsrResult` (the jobs package's
  `attachGeneratedTranscript` delegates to the same command), then
  captions derive through `syncCaptionsFromTranscript`.
- `ovm-media://` is a privileged, read-only protocol serving ONLY
  paths the main process explicitly allow-listed (imported media,
  generated outputs, rendered videos, opened project assets). It is
  never general filesystem access; the renderer still cannot touch
  arbitrary paths.
- Capability flags stay honest: the preload advertises the shell,
  but the Studio treats the main process's runtime `capabilities()`
  response as authoritative - localGeneration is true only when the
  generation service actually built (registry + runner manifests
  present).

## Consequences

- Desktop voiceover generation (Character Studio), model samples
  (Model Center) and transcription (Transcript panel) are real,
  cancellable local jobs with progress; generated media plays in the
  preview through ovm-media.
- The generation stack is the same code path as `ovm`/SDK jobs, so
  verified runners gain desktop support for free and vice versa.
- Packaged builds must bundle the registry data + runner adapters;
  until packaging lands, the dev app resolves them repo-relative
  (with `OVM_ROOT`/`OVM_HOME` overrides).

## Alternatives considered

- Returning model outputs as base64 through IPC: rejected - large
  media, memory churn; file references + a scoped protocol is safer.
- `webSecurity: false` / file:// access for local media: rejected -
  broad renderer privilege for a narrow need.
- A second renderer-side generation implementation: rejected - would
  break the one-operation-layer invariant.

# ADR-0011: Generation jobs land results through the operation layer

## Context

AI generation (TTS, ASR, ...) produces files; a product where those
files stay anonymous dead-ends would violate the core promise that
everything is editable. Generation also needs the same lifecycle
discipline as rendering: progress, cancellation, crash isolation, and
honest capability checks.

## Decision

- `@openvideomaker/jobs` runs capability requests (`GenerationRunner`)
  end to end: registry entry -> artifact store install -> uv-isolated
  runtime -> NDJSON runner protocol, resolved data-driven from
  `runners/<name>/runner.json` manifests - the jobs layer never
  imports model-specific code.
- Results land in projects ONLY through the core operation layer
  (`attachGeneratedMedia` / `attachGeneratedFile` /
  `attachTranscriptCaptions`): every generated asset and caption clip
  carries full `GenerationProvenance` (capability, model+revision,
  runner, settings, inputs, device, regenerable).
- Jobs share the uniform job shape (state/stage/progress/logs/subscribe)
  with RenderJob and DownloadJob for the future Job Center.
- The browser Studio shows the Generate affordance honestly: it is
  disabled (`capabilities.localGeneration === false`) and explains
  that generation runs in the desktop app.

## Consequences

- Generated media is durable project state with provenance; deleting
  or replacing a model never makes a project unreadable.
- Adding a model = registry metadata + adapter + manifest +
  verification; jobs, Studio and MCP never change.
- Cancellation is best-effort at the runner boundary (the protocol
  signals it; adapters cooperate).

## Alternatives considered

- Adapters writing directly into the project store: rejected -
  violates the one-operation-layer invariant.
- Hardcoding runner paths in the jobs layer: rejected - manifests keep
  discovery data-driven and first-party adapters swappable.

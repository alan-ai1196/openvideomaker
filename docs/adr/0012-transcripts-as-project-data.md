# ADR-0012: Transcripts are durable project data, not sidecar files

## Context

ASR produces text, but a product whose promise is "everything stays
editable" cannot leave transcripts as anonymous JSON next to media
files. Transcripts drive captions, search, silence removal and agent
editing - they belong in the project with the same operation/history
discipline as clips.

## Decision

- Transcripts are first-class project data: a time-aligned segment
  model linked one-to-one to an asset (`transcripts` +
  `assetTranscripts` in the Project), with typed operations
  (create/setSegments/setSegmentText/setLanguage/remove), invariant
  checks, and undo/redo/replay like every other entity.
- The source record distinguishes raw ASR output (with generation
  provenance) from imports and manual corrections.
- Caption clips are DERIVED from transcripts via the core command
  `syncCaptionsFromTranscript` - one idempotent, undoable transaction
  - so Studio, jobs, MCP and CLI share one implementation.
- Transcription itself stays a generation job (desktop app); the
  browser Studio edits existing transcripts honestly.

## Consequences

- Projects remain understandable after the producing model is gone.
- Later layers (silence removal, speaker labels, agent edits) build on
  the same document instead of inventing per-feature formats.
- Editing transcript text does not silently rewrite captions; the
  user re-syncs explicitly (predictable, reviewable).

## Alternatives considered

- Sidecar JSON next to assets: rejected - no history, no invariants,
  breaks project portability.
- Caption clips as the only transcript store: rejected - clips are
  presentation; word-level alignment, speakers and corrections need a
  richer document.

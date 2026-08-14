# Media intelligence: transcripts today, layered understanding next

Status: matches current code (round 31).

## What exists now: transcripts (level 1)

Transcripts are durable, editable project data (`@openvideomaker/schema`):
a time-aligned text representation linked one-to-one to a media asset,
stored in the project itself with typed operations
(`transcript.create/setSegments/setSegmentText/setLanguage/remove`) and
invariant checks (linkage, ordering, ranges). ASR results, imported
subtitles and manual corrections share the shape; the source record
distinguishes raw model output from user corrections and carries the
generation provenance for ASR-sourced transcripts.

Integration:

- Two verified ASR runners produce `transcript.json` + SRT
  (`runners/whisper-asr` for English, `runners/paraformer-asr` for
  Mandarin); `@openvideomaker/jobs` lands them as transcript documents
  via `attachGeneratedTranscript`.
- `syncCaptionsFromTranscript` (core command) rebuilds caption clips
  from transcript segments - idempotent, one undoable transaction,
  provenance-carrying. Studio, jobs and future MCP/CLI share it.
- The Studio Transcript panel: seek by clicking a segment, correct
  text inline (typed ops), sync captions. Browser mode edits
  transcripts honestly; transcription itself runs in the desktop app.

## Layer ladder

Level 0: file metadata - probed at import (`@openvideomaker/media`).

Level 1 (round 30): shots, audio structure, keyframes - ffmpeg-derived
on desktop import (scene-change detection, silencedetect, shot
midpoints), session-scoped presentation data.

Level 2 (round 31): shot-scoped speech and activity - pure, model-free
functions in `@openvideomaker/media/shot-analysis`:
`alignTranscriptToShots` maps durable transcript segments onto shots
by time overlap, `shotsWithSpeech` derives per-shot speech flags from
audio regions, `detectShotMotion` measures per-shot inter-frame luma
difference (ffmpeg signalstats YDIF, one extra decode pass), and
`classifyShots` labels shots speech/motion/still from those signals.
The shot structure also drives real edits: core `splitClipAtTimes`
and `removeRangesFromClip` (ripple-closed silence removal) power the
Inspector's shot actions. "Scene summaries" in the LLM sense are NOT
claimed here: the per-shot text is verbatim transcript overlap, and
speech/action classification is documented heuristics - no model, no
summarization.

Level 3 (round 35, honest lexical subset): transcript search and
keyword topics - deterministic, model-free tokenization (latin words
minus stopwords + CJK character bigrams), term-frequency keyword
ranking with segment timestamps, and token-overlap search with a
substring fallback (`@openvideomaker/media/topics`, pure, shipped as
a subpath so the browser bundle stays ffmpeg-free). The Studio
Transcript panel gains a search box (ranked hits that seek the
playhead) and per-transcript keyword chips. Entity extraction and
semantic (embedding) search are NOT claimed - they need a model and
remain future work; the scorers are swappable behind the same result
shapes.

Level 4: project narrative representation - not implemented; the
agent/EditPlan layer (a later round) will consume it.

Nothing here is fed to models as raw frame dumps; retrieval goes
coarse-first, precise-second once the upper layers exist.

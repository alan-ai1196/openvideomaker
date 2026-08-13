# Rendering

Status: matches current code.

## The two render paths

- **Interactive preview** (browser): HTMLVideoElement/WebAudio driven by the
  same playhead as the timeline - responsive, never authoritative.
- **Final render** (`@openvideomaker/render`): a render plan built from the
  Video IR, executed by FFmpeg. This is the authoritative path; it runs in
  the desktop app and via `ovm-render`, never inside the browser page.

## Render plan

`buildRenderPlan(project, options, resolveSource)` walks the active
sequence and produces a pure-data plan:

- per-clip video chains: trim to source in/out, speed, crop, rotation,
  fit-scale, opacity, fades; clips are overlay-ed onto a black canvas at
  their timeline positions, track by track (gaps stay black);
- text clips: `drawtext` with an explicit font file and position;
- caption clips: collected into a temporary SRT, rendered with the
  `subtitles` filter;
- audio: per-clip `atrim` + gain + fades + `adelay`, mixed with `amix`
  (audio-track clips always; video-track clips only with explicit audio
  settings - linked audio/video semantics arrive later);
- output: chosen encoder, quality (crf/cq), fps, duration, faststart.

Problems are collected, never swallowed: missing sources are plan errors
and a render refuses to start; warnings stay visible in the job.

## Encoders

`detectEncoders()` probes the real ffmpeg build (software: libx264/
libx265; hardware: NVENC/AMF/QSV/VideoToolbox) - never assumed from GPU
brand. `auto` prefers NVENC-class hardware encoders and, when a hardware
render fails, retries once with the software encoder. Hardware is an
accelerator, never a hard requirement.

## Jobs

Every render is a `RenderJob`: queued/running/completed/failed/cancelled,
progress parsed from ffmpeg's `-progress` stream, bounded stderr logs,
creator-facing classified failures. This is the seed of the Job Center
model that downloads and generations will reuse.

## Browser-mode honesty

The Studio Export dialog offers presets (1080p, vertical, square, source)
and quality, then explains that encoding runs on the user's machine:
it downloads the project and shows the exact `ovm-render` command.
The browser never pretends to run FFmpeg.

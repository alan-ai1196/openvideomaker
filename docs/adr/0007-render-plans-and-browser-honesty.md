# ADR-0007: FFmpeg render plans with probed encoders and browser honesty

## Context

Final rendering must be authoritative and reproducible outside the
browser, must not assume hardware capabilities from GPU brand, must fail
visibly instead of silently, and the browser Studio must not pretend to
do what it cannot do.

## Decision

- Rendering is a pure-data **render plan** built from the Video IR
  (filter graph + encoder args), executed by FFmpeg in
  `@openvideomaker/render`. The plan is inspectable, testable and
  loggable independently of execution.
- Encoders are **probed** from the actual ffmpeg build; `auto` prefers
  NVENC-class hardware and automatically retries once with software when
  a hardware render fails.
- Every render is a **RenderJob** (state/progress/logs/cancel) - the seed
  of the Job Center model.
- Browser mode stays honest: the Export dialog prepares the project and
  shows the local `ovm-render` command instead of faking in-page encoding.

## Consequences

- Desktop (Electron later) and CLI share one render implementation; the
  Studio adds no second render path.
- Captions and text are part of the authoritative render (SRT + drawtext),
  not a preview-only illusion.
- A future local/remote render bridge plugs into the same plan and job
  types.

## Alternatives considered

- ffmpeg.wasm in the browser: rejected - heavy, memory-limited, and the
  authoritative path belongs on the user's machine.
- Canvas/MediaRecorder capture of the preview: rejected - preview-quality
  output would silently downgrade user expectations.

# ADR-0010: Device graph - probed capabilities, never assumed

## Context

The same machine answers the same hardware questions in many places:
the export pipeline picks an encoder, the runner host decides whether
CUDA models can run, the doctor command reports on the machine, and a
future Device Center shows it all. Each answer must be true at runtime,
not guessed from brand names or platform.

## Decision

- One probed `DeviceGraph` (`@openvideomaker/devices`): OS, CPU, memory,
  GPUs (via `nvidia-smi`), ffmpeg version, probed encoders (reusing
  `@openvideomaker/render`'s `detectEncoders`), and toolchain runtimes
  (ffmpeg/ffprobe/node/uv/python), zod-validated at the boundary.
- Absence is data, not an error: a missing `nvidia-smi`, `uv` or
  encoder is reported as an empty list / false capability plus a
  doctor note, never an exception or a fabricated default.
- Derived `capabilities` (videoEncode, hardwareVideoEncode, aiRunners)
  are computed from probed facts only.
- One CLI entry point (`ovm-doctor`, `--json` / `--strict`) and one
  `probeDeviceGraph()` function shared by the future Device Center.

## Consequences

- New hardware vendors add a new probe function, not new assumptions.
- Encoder choices stay in `render`; devices reuses them, so the two
  can never drift.
- The graph is ephemeral runtime diagnostics; it deliberately lives
  outside the Video IR schemas (no durable project state here).

## Alternatives considered

- Sniffing GPU brand from strings or `dxdiag` output: rejected -
  fragile, slow, and vendor-assumptive.
- Storing the graph in the project: rejected - device facts change
  between machines and sessions; projects must stay hardware-neutral.

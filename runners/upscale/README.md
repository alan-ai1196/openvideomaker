# upscale - Real-ESRGAN image upscaling runner

First-party adapter for the `video.upscale` capability: Real-ESRGAN
x4plus (RRDBNet, BSD-3-Clause) speaking the OpenVideoMaker runner
protocol (NDJSON over stdio). The RRDBNet architecture is reproduced
from upstream (attributed in `runner.py`) so the runtime needs ONLY
torch - upstream's basicsr package is stale against current
torchvision.

- `runner.json` - data-driven runner manifest.
- `runner.py` - describe/prepare/execute/health/dispose; heavy imports at
  module level BEFORE the stdin loop (Windows import deadlock). No
  downloads at runtime.
- `requirements.txt` - torch only, in an isolated uv runtime.
- `analyze.py` - PSNR of the 4x output against the true high-res
  reference versus a bicubic baseline (objective quality evidence).
- `verify.mjs` - re-runnable end-to-end verification: store install,
  uv runtime, runner protocol, 4x output - the model must beat bicubic.

Run: `node runners/upscale/verify.mjs`

Model: RealESRGAN_x4plus.pth from the official GitHub release
(67,040,989 bytes, sha256 `4fa0d389...`). Upstream:
[xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (BSD-3-Clause).

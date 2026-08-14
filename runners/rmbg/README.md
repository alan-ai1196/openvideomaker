# rmbg - background removal runner

First-party adapter for the `media.background_remove` capability:
IS-Net general use (DIS, Apache-2.0) via ONNX Runtime, speaking the
OpenVideoMaker runner protocol (NDJSON over stdio).

- `runner.json` - the data-driven runner manifest (capability, model,
  entry point, model-file mapping).
- `runner.py` - the adapter: describe/prepare/execute/health/dispose.
  Heavy imports happen at module level BEFORE the stdin loop (Windows
  torch/numpy-style import deadlock avoidance; see the runner-host
  hardening notes). Preprocessing matches upstream rembg's DisSession
  contract for `isnet-general-use.onnx`.
- `requirements.txt` - onnxruntime + pillow + numpy in an isolated uv
  runtime; the adapter performs NO downloads at runtime.
- `make_fixture.py` / `analyze.py` - deterministic test fixture and
  objective alpha-matting measurement used by `verify.mjs`.
- `verify.mjs` - re-runnable end-to-end verification: artifact store
  download -> uv runtime -> runner protocol -> RGBA cutout -> subject
  vs background alpha statistics (a real face frame when the upstream
  LatentSync demo clone is present, else a synthetic subject).

```bash
node runners/rmbg/verify.mjs
```

Model: [isnet-general-use.onnx](https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx)
(178,648,008 bytes, sha256 `60920e99...`, from the official rembg
release). Upstream source: [xuebinqin/DIS](https://github.com/xuebinqin/DIS)
(Apache-2.0).

# latentsync - avatar.lip_sync runner

First-party adapter for LatentSync 1.5 (ByteDance): latent diffusion lip
synchronization over the OpenVideoMaker runner protocol
(describe/prepare/execute/progress/cancel/health/dispose).

## Layout

- runner.py - the protocol adapter. A faithful, hermetic reimplementation
  of the upstream scripts/inference.py entrypoint: weights come from the
  artifact store as local paths, and the adapter never downloads anything.
- runner.json - data-driven manifest mapping the registry file manifest
  to adapter keys (unet, whisper tiny encoder, SD VAE, InsightFace models).
- requirements.txt - the upstream inference stack (torch 2.5.1 cu121 pin
  kept) minus training/gradio-only dependencies.
- verify.mjs - real end-to-end verification against the upstream demo
  assets (re-runnable; artifacts under .research/).

## Vendored upstream code

vendor/ contains the upstream latentsync Python package (Apache-2.0),
pinned at commit a229c3948406bc2cf6eaf4873e662e70c6a04746, plus the
stage2_512.yaml model config, the DDIM scheduler config and the mouth
mask, excluding the training/eval-only data/ and trepa/ modules.
Each file keeps its original Apache-2.0 header. Adapter-local patches are
marked "OVM adapter patch" and are limited to:

1. decord-free audio decoding (decord has no official Windows wheels) -
   read_audio uses the ffmpeg binary that imageio-ffmpeg ships, and
   ffmpeg is invoked with argument arrays, never shell interpolation;
2. a lazy matplotlib import (training-only plotting);
3. the InsightFace model root reads OVM_AUX_DIR, so the unpacked
   buffalo_l models come from the artifact store, never a runtime
   download;
4. InsightFace runs on the CPU execution provider (the GPU provider would
   require a system cuDNN that OVM runtimes deliberately do not assume);
5. the final video/audio mux is an argument-array ffmpeg call.

## Verification

node verify.mjs runs the full protocol path against the upstream
assets/demo1_* clip: weights through the artifact store, an isolated uv
runtime, a real CUDA fp16 inference, and an ffprobe of the output. See
the registry entry hf/bytedance/latentsync-1.5 for the pinned file
manifest and the dated verification evidence.

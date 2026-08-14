# Supported models

Generated from the model registry - do not edit by hand. Run
`node scripts/generate-model-docs.mjs` and commit the result.

Every entry records its trust state honestly. `unverified` means the
metadata below was checked against the upstream hub but OpenVideoMaker
has not yet run the model. No entry here is presented as working until
a runner slice verifies it.

## Speech (3)

### Kokoro TTS

- **Id:** `hf/hexgrad/Kokoro-82M` - **Trust:** verified
- **Upstream:** [hexgrad/kokoro](https://github.com/hexgrad/kokoro)
- **License:** Apache License 2.0 (https://huggingface.co/hexgrad/Kokoro-82M)
- **Capabilities:** audio.tts
- **Runner:** local-python (kokoro adapter (runners/kokoro-tts))
- **Hardware:** cuda/expected, cpu/tested, mlx/untested, rocm/untested
- **Memory:** Small model; upstream reports real-time synthesis on CPU.
- **Limitations:** English and a small set of additional languages; no voice cloning out of the box.
- **Evidence:** Executed 2026-08-13: weights fetched through the OpenVideoMaker artifact store (sha256s computed from the official Hugging Face download), model loaded in an isolated uv runtime (kokoro 0.9.4, CPU), and 'audio.tts' ran through the runner protocol - produced a 3.3s 24kHz WAV probed with ffprobe. sha256s above are the measured content hashes.

### Whisper Large v3

- **Id:** `hf/openai/whisper-large-v3` - **Trust:** verified
- **Upstream:** [openai/whisper](https://github.com/openai/whisper)
- **License:** Apache License 2.0 (https://huggingface.co/openai/whisper-large-v3/blob/main/LICENSE)
- **Capabilities:** audio.asr
- **Runner:** local-python (faster-whisper adapter (runners/whisper-asr) over the Systran CTranslate2 weights)
- **Hardware:** cuda/tested, cpu/expected, mlx/untested, rocm/untested
- **Memory:** Large ASR model (~2.9 GB fp16 weights); smaller whisper variants exist for weak hardware.
- **Limitations:** Transcription of noisy or overlapping speech degrades; no speaker diarization built in.
- **Evidence:** Executed 2026-08-14: the official CTranslate2 weights fetched through the OpenVideoMaker artifact store (model.bin pinned from the HF LFS oid; small files measured from the official download), loaded in an isolated uv runtime (faster-whisper 1.2.1, CUDA float16 on an RTX 3090), and 'audio.asr' executed through the runner protocol on Kokoro-synthesized speech - transcribed 'Make videos with AI and keep everything editable.' with 8/8 word overlap, producing timed segments and SRT captions.

### Paraformer (Chinese)

- **Id:** `ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` - **Trust:** verified
- **Upstream:** [FunASR](https://github.com/modelscope/FunASR)
- **License:** Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- **Capabilities:** audio.asr
- **Runner:** local-python (funasr adapter (runners/paraformer-asr), local model directory)
- **Hardware:** cuda/expected, cpu/tested, mlx/unavailable, rocm/untested
- **Memory:** Runs on CPU as well as GPU (~840 MB fp32 weights).
- **Limitations:** Mandarin-focused; mixed-language audio is approximate. No segment-level timestamps out of the box - the adapter emits one caption span per utterance.
- **Evidence:** Executed 2026-08-14: weights fetched through the OpenVideoMaker artifact store from ModelScope (sha256s are measured content hashes), the model loaded in an isolated uv runtime (funasr 1.4.1 + torch, CPU), and 'audio.asr' executed through the runner protocol on Windows-SAPI-synthesized Mandarin speech (Huihui voice) - transcribed the known sentence with 14/14 character overlap, producing a transcript and SRT captions.

## Lip Sync (2)

### LatentSync 1.5

- **Id:** `hf/bytedance/latentsync-1.5` - **Trust:** verified
- **Upstream:** [bytedance/LatentSync](https://github.com/bytedance/LatentSync)
- **License:** OpenRAIL++-M (https://huggingface.co/bytedance/latentsync-1.5) - OpenRAIL licenses carry behavioral use restrictions; review before commercial use.
- **Capabilities:** avatar.lip_sync
- **Runner:** local-python (latentsync adapter (runners/latentsync))
- **Hardware:** cuda/tested, cpu/unavailable, mlx/unavailable, rocm/untested
- **Memory:** GPU required; verified on a 24 GB RTX 3090 in fp16 at 512px inference.
- **Limitations:** Needs a cropped, frontal face; quality depends on source identity preservation.
- **Evidence:** Executed 2026-08-14: all files fetched through the OpenVideoMaker artifact store (sha256s pinned from the official hub), an isolated uv runtime (torch 2.5.1 cu121), and avatar.lip_sync through the runner protocol on an RTX 3090 (CUDA fp16, 512px): a 5.08s 1080x1920 mp4 with video+audio, a detected face (0.87), and a mouth region that changed 7.9x the frame average while the rest of the frame stayed intact (MAD 1.65). The adapter pre-places InsightFace models, so the runtime performs no downloads.

### MuseTalk

- **Id:** `hf/TMElyralab/MuseTalk` - **Trust:** unverified
- **Upstream:** [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk)
- **License:** CreativeML OpenRAIL-M (https://huggingface.co/TMElyralab/MuseTalk) - Weights are OpenRAIL-M; the upstream code is MIT. OpenRAIL licenses carry behavioral use restrictions; review before commercial use.
- **Capabilities:** avatar.lip_sync
- **Runner:** local-python (musetalk adapter (runners/musetalk))
- **Hardware:** cuda/expected, cpu/unavailable, mlx/unavailable, rocm/untested
- **Memory:** GPU required; community reports vary by resolution.
- **Limitations:** Best with frontal faces; visual quality varies with pose and lighting. No OpenVideoMaker runner yet: v1.5 inference requires mmpose, whose chumpy dependency does not build on Windows py3.12 in isolated runtimes (see docs/research/musetalk-mmpose-blocker.md).
- **Evidence:** Registry metadata (id, license) checked against the Hugging Face API on 2026-08-13; the full file manifest is pinned from official hubs (measured sha256s) so installation is ready; inference not exercised because the mmpose dependency chain is blocked (research note documents the exact blocker).

## Video Generation (2)

### LTX-Video

- **Id:** `hf/Lightricks/LTX-Video` - **Trust:** unverified
- **Upstream:** [Lightricks/LTX-Video](https://github.com/Lightricks/LTX-Video)
- **License:** LTX-Video Community License (https://huggingface.co/Lightricks/LTX-Video) - Custom community license; review before commercial use.
- **Capabilities:** video.text_to_video
- **Runner:** local-python (ltx-video adapter)
- **Hardware:** cuda/expected, cpu/unavailable, mlx/untested, rocm/untested
- **Memory:** Designed to run on consumer GPUs.
- **Limitations:** Short clips; complex scenes and text rendering can be imperfect.
- **Evidence:** Registry metadata (id, custom community license, availability) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

### Wan 2.2 (14B)

- **Id:** `hf/Wan-AI/Wan2.2-T2V-A14B` - **Trust:** unverified
- **Upstream:** [Wan-AI/Wan2.2](https://github.com/Wan-Video/Wan2.2)
- **License:** Apache License 2.0 (https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B)
- **Capabilities:** video.text_to_video
- **Runner:** local-python (wan adapter)
- **Hardware:** cuda/expected, cpu/unavailable, mlx/untested, rocm/untested
- **Memory:** Very large model; expects a high-VRAM GPU. Smaller Wan variants exist.
- **Limitations:** Heavy compute; long generation times without a strong GPU.
- **Evidence:** Registry metadata (id, Apache-2.0 license, availability) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

## Images (1)

### FLUX.1 schnell

- **Id:** `hf/black-forest-labs/FLUX.1-schnell` - **Trust:** unverified
- **Upstream:** [black-forest-labs/flux](https://github.com/black-forest-labs/flux)
- **License:** Apache License 2.0 (https://huggingface.co/black-forest-labs/FLUX.1-schnell)
- **Capabilities:** image.generate
- **Runner:** local-python (diffusers adapter)
- **Hardware:** cuda/expected, cpu/untested, mlx/untested, rocm/untested
- **Memory:** Consumer GPU required for practical use.
- **Limitations:** Schnell trades fidelity for speed; the dev variant is higher quality.
- **Evidence:** Registry metadata (id, Apache-2.0 license) and the ModelScope mirror checked against both hub APIs on 2026-08-13; inference not yet exercised by OpenVideoMaker.

## Enhancement (2)

### IS-Net general use

- **Id:** `gh/danielgatis/rembg-isnet-general-use` - **Trust:** verified
- **Upstream:** [xuebinqin/DIS (weights via danielgatis/rembg releases)](https://github.com/xuebinqin/DIS)
- **License:** Apache License 2.0 (https://github.com/xuebinqin/DIS) - Upstream code and weights are Apache-2.0.
- **Capabilities:** media.background_remove
- **Runner:** local-python (rmbg adapter (runners/rmbg); ONNX Runtime)
- **Hardware:** cpu/tested, cuda/untested, mlx/untested, rocm/untested
- **Memory:** Weights ~178 MB; verified at 1080x1920 in ~1.0s on CPU (onnxruntime 1.28).
- **Limitations:** Saliency-based: the model chooses the subject, so results vary on busy scenes; fine hair and transparency are approximate.; Single-image inputs; frame-by-frame video matting is future work.
- **Evidence:** Executed 2026-08-14: the official isnet-general-use.onnx (178,648,008 bytes, sha256 pinned) fetched through the OpenVideoMaker artifact store, an isolated uv runtime (onnxruntime 1.28.0 + pillow 12.3.0 + numpy 2.5.2, CPU), and media.background_remove through the runner protocol on a real frame (1080x1920, upstream LatentSync demo: a face on a plain background): RGBA cutout in ~1.0s with mean subject alpha 0.81 (center region) vs 0.0005 in the background corners (alpha gap 0.81). The adapter performs no downloads at runtime.

### RMBG-2.0

- **Id:** `hf/briaai/RMBG-2.0` - **Trust:** unverified
- **Upstream:** [briaai/RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0)
- **License:** BRIA RMBG-2.0 License (https://huggingface.co/briaai/RMBG-2.0) - Custom source-available license; commercial use may require a BRIA agreement.
- **Capabilities:** media.background_remove
- **Runner:** local-python (transformers adapter)
- **Hardware:** cuda/expected, cpu/expected, mlx/untested, rocm/untested
- **Memory:** Runs on CPU; GPU faster.
- **Limitations:** Tuned for subjects like people, products and animals; artistic backgrounds vary.
- **Evidence:** Registry metadata (id, custom license) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.


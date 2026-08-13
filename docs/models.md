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

- **Id:** `hf/openai/whisper-large-v3` - **Trust:** unverified
- **Upstream:** [openai/whisper](https://github.com/openai/whisper)
- **License:** Apache License 2.0 (https://huggingface.co/openai/whisper-large-v3/blob/main/LICENSE)
- **Capabilities:** audio.asr
- **Runner:** local-python (whisper / faster-whisper adapters)
- **Hardware:** cuda/expected, cpu/expected, mlx/untested, rocm/untested
- **Memory:** Large ASR model; smaller whisper variants exist for weak hardware.
- **Limitations:** Transcription of noisy or overlapping speech degrades; no speaker diarization built in.
- **Evidence:** Registry metadata (id, license, availability) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

### Paraformer (Chinese)

- **Id:** `ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` - **Trust:** unverified
- **Upstream:** [FunASR](https://github.com/modelscope/FunASR)
- **License:** Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- **Capabilities:** audio.asr
- **Runner:** local-python (funasr adapter)
- **Hardware:** cuda/expected, cpu/expected, mlx/unavailable, rocm/untested
- **Memory:** Runs on CPU as well as GPU.
- **Limitations:** Mandarin-focused; mixed-language audio is approximate.
- **Evidence:** Registry metadata (id, availability, Apache-2.0 license) checked against the ModelScope API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

## Lip Sync (2)

### LatentSync 1.5

- **Id:** `hf/bytedance/latentsync-1.5` - **Trust:** unverified
- **Upstream:** [bytedance/LatentSync](https://github.com/bytedance/LatentSync)
- **License:** OpenRAIL++-M (https://huggingface.co/bytedance/latentsync-1.5) - OpenRAIL licenses carry behavioral use restrictions; review before commercial use.
- **Capabilities:** avatar.lip_sync
- **Runner:** local-python (latentsync adapter)
- **Hardware:** cuda/expected, cpu/unavailable, mlx/unavailable, rocm/untested
- **Memory:** GPU required; exact VRAM depends on resolution and frames.
- **Limitations:** Needs a cropped, frontal face; quality depends on source identity preservation.
- **Evidence:** Registry metadata (id, OpenRAIL++ license, availability) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

### MuseTalk

- **Id:** `hf/TMElyralab/MuseTalk` - **Trust:** unverified
- **Upstream:** [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk)
- **License:** CreativeML OpenRAIL-M (https://huggingface.co/TMElyralab/MuseTalk) - OpenRAIL licenses carry behavioral use restrictions; review before commercial use.
- **Capabilities:** avatar.lip_sync
- **Runner:** local-python (musetalk adapter)
- **Hardware:** cuda/expected, cpu/unavailable, mlx/unavailable, rocm/untested
- **Memory:** GPU required; community reports vary by resolution.
- **Limitations:** Best with frontal faces; visual quality varies with pose and lighting.
- **Evidence:** Registry metadata (id, license) checked against the Hugging Face API on 2026-08-13; inference not yet exercised by OpenVideoMaker.

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

## Enhancement (1)

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


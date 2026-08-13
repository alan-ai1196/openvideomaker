# Whisper ASR runner

Implements the OpenVideoMaker runner protocol (NDJSON over stdio) for
the `audio.asr` capability using Whisper Large v3 via faster-whisper
(CTranslate2). See `docs/architecture/MODEL_RUNTIME.md` for the protocol.

## Runtime

- Isolated uv-managed Python environment (never the global Python).
- `requirements.txt` pins the adapter dependency set (faster-whisper
  plus the `nvidia-cublas-cu12` wheel, whose DLLs the adapter registers
  via `add_dll_directory` + PATH so CUDA works without a system CUDA
  toolkit).
- Weights come from the OpenVideoMaker artifact store: the host passes
  the five CTranslate2 files (model/config/tokenizer/preprocessor/
  vocabulary) as individual file refs and the adapter materializes them
  into a canonical model directory.
- Devices: `cuda` (float16) with an automatic fallback to `cpu` (int8);
  `mlx`/`rocm` are rejected honestly (faster-whisper does not support
  them).

## Outputs

- `transcript.json` - language, full text and timed segments (ms).
- `transcript.srt` - SRT captions ready for the Studio caption pipeline.

## Verification status

**Verified** (2026-08-14): the registry entry `hf/openai/whisper-large-v3`
is `verified` - the official CTranslate2 weights fetched through the
artifact store, the model loaded in an isolated uv runtime (CUDA
float16 on an RTX 3090), and `audio.asr` executed through the runner
protocol on Kokoro-synthesized speech: 8/8 word overlap and SRT
captions produced.

Re-run the verification any time:

```
node runners/whisper-asr/verify.mjs
```

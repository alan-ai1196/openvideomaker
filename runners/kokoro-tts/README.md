# Kokoro TTS runner

Implements the OpenVideoMaker runner protocol (NDJSON over stdio) for the
`audio.tts` capability using the Kokoro-82M model. See
`docs/architecture/MODEL_RUNTIME.md` for the protocol.

## Runtime

- Isolated uv-managed Python environment (never the global Python).
- `requirements.txt` pins the adapter dependency set.
- Model weights come from the OpenVideoMaker artifact store (the host
  passes their paths via the prepare/execute modelFiles and inputs).

## Verification status

**Verified** (2026-08-13): the registry entry `hf/hexgrad/Kokoro-82M` is
`verified` - weights fetched through the artifact store, the model loaded
in an isolated uv runtime, and `audio.tts` executed through the runner
protocol, producing a 3.3s 24kHz WAV confirmed with ffprobe.

Re-run the verification any time:

```
node runners/kokoro-tts/verify.mjs
```
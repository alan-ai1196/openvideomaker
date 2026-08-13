# Paraformer ASR runner

Implements the OpenVideoMaker runner protocol (NDJSON over stdio) for
the `audio.asr` capability in Mandarin via FunASR Paraformer-large.
See `docs/architecture/MODEL_RUNTIME.md` for the protocol.

## Runtime

- Isolated uv-managed Python environment (never the global Python).
- `requirements.txt` pins the adapter dependency set (funasr, which
  brings torch/torchaudio on Windows as CPU wheels).
- Weights come from the OpenVideoMaker artifact store: the host passes
  the six ModelScope files (model/config/am.mvn/seg_dict/tokens/
  configuration) as individual file refs and the adapter materializes
  them into a canonical model directory.
- Devices: `cuda` with an automatic fallback to `cpu`; `mlx`/`rocm` are
  rejected honestly (funasr does not support them).

## Outputs

- `transcript.json` - language, full text and one timed span (Paraformer
  is utterance-level; no per-word timestamps).
- `transcript.srt` - SRT captions ready for the Studio caption pipeline.

## Verification status

**Verified** (2026-08-14): the registry entry
`ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
is `verified` - weights fetched through the artifact store from
ModelScope, the model loaded in an isolated uv runtime, and `audio.asr`
executed through the runner protocol on Windows-SAPI-synthesized
Mandarin speech (Huihui voice), producing a transcript with high
character overlap plus SRT captions.

Re-run the verification any time:

```
node runners/paraformer-asr/verify.mjs
```

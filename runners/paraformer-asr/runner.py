#!/usr/bin/env python3
"""
Paraformer ASR runner - implements the OpenVideoMaker runner protocol
(NDJSON over stdio) for the audio.asr capability (Mandarin) via FunASR.

Model weights arrive as local paths from the host (fetched through the
OpenVideoMaker artifact store); this adapter never downloads anything.
"""
import contextlib
import io
import json
import logging
import os
import sys

MODEL = None
DEVICE = "cpu"
MODEL_DIR = None

# funasr prints to stdout and tqdm draws progress bars: both would
# corrupt the NDJSON protocol stream, so keep a handle on the real
# stdout and silence the rest.
STDOUT = sys.stdout
DISCARD = io.StringIO()
os.environ.setdefault("TQDM_DISABLE", "1")


def send(message):
    STDOUT.write(json.dumps(message) + "\n")
    STDOUT.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


def materialize_model_dir(files):
    """The store is content-addressed; funasr wants a directory with
    canonical names, so materialize the six files once."""
    import shutil
    import tempfile
    names = {
        "model": "model.pt",
        "config": "config.yaml",
        "am_mvn": "am.mvn",
        "seg_dict": "seg_dict",
        "tokens": "tokens.json",
        "configuration": "configuration.json",
    }
    target = tempfile.mkdtemp(prefix="ovm-paraformer-")
    for key, name in names.items():
        ref = files.get(key, {})
        path = ref.get("path")
        if not path or not os.path.exists(path):
            raise RuntimeError("prepare requires modelFiles." + key + ".path")
        shutil.copyfile(path, os.path.join(target, name))
    return target


def load_model(params):
    global MODEL, DEVICE, MODEL_DIR
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING, force=True)
    with contextlib.redirect_stdout(DISCARD):
        from funasr import AutoModel
    files = params.get("modelFiles", {})
    if MODEL_DIR is None:
        MODEL_DIR = materialize_model_dir(files)
    device = params.get("device") or "cpu"
    if device in ("mlx", "rocm"):
        raise RuntimeError("unsupported device " + device + " (funasr supports cuda and cpu)")
    if device == "cuda":
        try:
            log("info", "loading paraformer on cuda")
            with contextlib.redirect_stdout(DISCARD):
                MODEL = AutoModel(model=MODEL_DIR, device="cuda:0", disable_update=True)
            DEVICE = "cuda"
        except Exception as err:  # noqa: BLE001 - honest fallback, logged
            log("warn", "cuda load failed (" + str(err) + "): falling back to cpu")
            with contextlib.redirect_stdout(DISCARD):
                MODEL = AutoModel(model=MODEL_DIR, device="cpu", disable_update=True)
            DEVICE = "cpu"
    else:
        with contextlib.redirect_stdout(DISCARD):
            MODEL = AutoModel(model=MODEL_DIR, device="cpu", disable_update=True)
        DEVICE = "cpu"
    log("info", "paraformer model loaded on " + DEVICE)


def srt_time(ms):
    h = ms // 3600000
    m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000
    milli = ms % 1000
    return "%02d:%02d:%02d,%03d" % (h, m, s, milli)


def segments_to_srt(segments):
    lines = []
    for i, seg in enumerate(segments):
        lines.append(str(i + 1))
        lines.append(srt_time(seg["startMs"]) + " --> " + srt_time(seg["endMs"]))
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def audio_duration_ms(audio_path, fallback_ms):
    try:
        import wave
        with wave.open(audio_path, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate > 0:
                return int(frames * 1000 / rate)
    except Exception:  # noqa: BLE001 - non-WAV inputs use the fallback
        pass
    return int(fallback_ms or 0)


def run_asr(params):
    global MODEL
    audio_path = params.get("inputs", {}).get("audio", {}).get("path")
    settings = params.get("settings", {}) or {}
    output_dir = params.get("outputDir")
    if not audio_path or not os.path.exists(audio_path):
        raise RuntimeError("execute requires inputs.audio.path pointing at an audio file")
    if not output_dir:
        raise RuntimeError("execute requires outputDir")
    os.makedirs(output_dir, exist_ok=True)
    use_itn = bool(settings.get("useItn", True))
    send({"kind": "progress", "stage": "transcribing", "message": "running paraformer"})
    with contextlib.redirect_stdout(DISCARD):
        result = MODEL.generate(input=audio_path, language="zh", use_itn=use_itn, batch_size_s=60)
    text = ""
    if result and isinstance(result, list) and result[0] and isinstance(result[0], dict):
        text = str(result[0].get("text", "")).strip()
    duration_ms = audio_duration_ms(audio_path, int(settings.get("durationUs", 0)) / 1000)
    segments = [{"id": 0, "startMs": 0, "endMs": duration_ms, "text": text}]
    transcript = {"language": "zh", "text": text, "segments": segments}
    transcript_path = os.path.join(output_dir, "transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as fh:
        json.dump(transcript, fh, ensure_ascii=False, indent=2)
    srt_path = os.path.join(output_dir, "transcript.srt")
    with open(srt_path, "w", encoding="utf-8") as fh:
        fh.write(segments_to_srt(segments))
    log("info", "transcribed " + str(len(text)) + " characters")
    return transcript_path, srt_path, transcript, duration_ms


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            send({"id": None, "ok": False, "error": {"code": "protocol", "message": "unparseable request"}})
            continue
        method = request.get("method")
        try:
            if method == "describe":
                send({
                    "id": request["id"], "ok": True, "protocolVersion": 1,
                    "capabilities": ["audio.asr"],
                    "models": ["ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"],
                    "runner": {"name": "paraformer-asr", "version": "0.1.0"},
                })
            elif method == "prepare":
                load_model(request.get("params", {}))
                send({"id": request["id"], "ok": True, "estimate": {"note": "Paraformer on " + DEVICE}})
            elif method == "execute":
                transcript_path, srt_path, transcript, duration_ms = run_asr(request.get("params", {}))
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {
                        "transcript": {"path": transcript_path},
                        "srt": {"path": srt_path},
                    },
                    "metadata": {
                        "durationUs": int(duration_ms * 1000),
                        "language": transcript["language"],
                        "segments": len(transcript["segments"]),
                        "capability": "audio.asr",
                        "device": DEVICE,
                    },
                })
            elif method == "health":
                send({"id": request["id"], "ok": True})
            elif method == "cancel":
                send({"kind": "cancelled"})
            elif method == "dispose":
                send({"id": request["id"], "ok": True})
                break
            else:
                send({"id": request["id"], "ok": False, "error": {"code": "protocol", "message": "unknown method " + str(method)}})
        except Exception as err:  # noqa: BLE001 - protocol boundary
            send({"id": request.get("id"), "ok": False, "error": {"code": "runner.failed", "message": str(err)}})


if __name__ == "__main__":
    main()

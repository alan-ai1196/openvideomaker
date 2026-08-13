#!/usr/bin/env python3
"""
Whisper ASR runner - implements the OpenVideoMaker runner protocol
(NDJSON over stdio) for the audio.asr capability via faster-whisper.

Model weights arrive as local paths from the host (they were fetched
through the OpenVideoMaker artifact store); this adapter never
downloads anything itself.
"""
import json
import os
import sys

MODEL = None
DEVICE = "cpu"
COMPUTE_TYPE = "int8"


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


MODEL_DIR = None


def materialize_model_dir(files):
    """
    The store is content-addressed (hash-named files), while
    faster-whisper wants a directory with canonical names, so
    materialize the five files into a private temp dir once.
    """
    import shutil
    import tempfile
    names = {
        "model": "model.bin",
        "config": "config.json",
        "tokenizer": "tokenizer.json",
        "preprocessor": "preprocessor_config.json",
        "vocabulary": "vocabulary.json",
    }
    target = tempfile.mkdtemp(prefix="ovm-whisper-")
    for key, name in names.items():
        ref = files.get(key, {})
        path = ref.get("path")
        if not path or not os.path.exists(path):
            raise RuntimeError("prepare requires modelFiles." + key + ".path")
        shutil.copyfile(path, os.path.join(target, name))
    return target


def add_nvidia_dll_dirs():
    """
    ctranslate2's Windows build loads CUDA runtime DLLs (cublas) that
    are not always on PATH; the nvidia-*-cu12 pip wheels ship them
    under site-packages/nvidia/<pkg>/bin, so register those dirs the
    same way torch does.
    """
    if os.name != "nt":
        return
    import sysconfig
    purelib = sysconfig.get_paths().get("purelib") or ""
    nvidia_root = os.path.join(purelib, "nvidia")
    if not os.path.isdir(nvidia_root):
        return
    for package in os.listdir(nvidia_root):
        bin_dir = os.path.join(nvidia_root, package, "bin")
        if os.path.isdir(bin_dir):
            try:
                os.add_dll_directory(bin_dir)
            except OSError:
                pass
            # ctranslate2's Windows loader additionally resolves the
            # CUDA runtime through PATH, so cover both search paths.
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


def load_model(params):
    global MODEL, DEVICE, COMPUTE_TYPE, MODEL_DIR
    add_nvidia_dll_dirs()
    from faster_whisper import WhisperModel
    files = params.get("modelFiles", {})
    if MODEL_DIR is None:
        MODEL_DIR = materialize_model_dir(files)
    device = params.get("device") or "cpu"
    if device in ("mlx", "rocm"):
        raise RuntimeError("unsupported device " + device + " (faster-whisper supports cuda and cpu)")
    if device == "cuda":
        try:
            log("info", "loading whisper on cuda (float16)")
            MODEL = WhisperModel(MODEL_DIR, device="cuda", compute_type="float16")
            DEVICE = "cuda"
            COMPUTE_TYPE = "float16"
        except Exception as err:  # noqa: BLE001 - honest fallback, logged
            log("warn", "cuda load failed (" + str(err) + "): falling back to cpu/int8")
            MODEL = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8")
            DEVICE = "cpu"
            COMPUTE_TYPE = "int8"
    else:
        MODEL = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8")
        DEVICE = "cpu"
        COMPUTE_TYPE = "int8"
    log("info", "whisper model loaded on " + DEVICE + "/" + COMPUTE_TYPE)


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
    language = settings.get("language") or None
    task = settings.get("task") or "transcribe"
    beam_size = int(settings.get("beamSize", 1))
    segments_iter, info = MODEL.transcribe(
        audio_path, language=language, task=task, beam_size=beam_size, vad_filter=False
    )
    language_detected = getattr(info, "language", None)
    duration_sec = float(getattr(info, "duration", 0.0) or 0.0)
    segments = []
    text_parts = []
    for i, seg in enumerate(segments_iter):
        start_ms = int(round(float(seg.start) * 1000))
        end_ms = int(round(float(seg.end) * 1000))
        text = str(seg.text).strip()
        segments.append({"id": i, "startMs": start_ms, "endMs": end_ms, "text": text})
        text_parts.append(text)
        send({"kind": "progress", "stage": "transcribing", "message": "segment " + str(i + 1)})
    transcript = {
        "language": language_detected,
        "text": " ".join(text_parts).strip(),
        "segments": segments,
    }
    transcript_path = os.path.join(output_dir, "transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as fh:
        json.dump(transcript, fh, ensure_ascii=False, indent=2)
    srt_path = os.path.join(output_dir, "transcript.srt")
    with open(srt_path, "w", encoding="utf-8") as fh:
        fh.write(segments_to_srt(segments))
    log("info", "transcribed " + str(len(segments)) + " segments, language " + str(language_detected))
    return transcript_path, srt_path, transcript, duration_sec


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
                    "models": ["hf/openai/whisper-large-v3"],
                    "runner": {"name": "whisper-asr", "version": "0.1.0"},
                })
            elif method == "prepare":
                load_model(request.get("params", {}))
                send({"id": request["id"], "ok": True, "estimate": {"note": "Whisper Large v3 on " + DEVICE + "/" + COMPUTE_TYPE}})
            elif method == "execute":
                transcript_path, srt_path, transcript, duration_sec = run_asr(request.get("params", {}))
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {
                        "transcript": {"path": transcript_path},
                        "srt": {"path": srt_path},
                    },
                    "metadata": {
                        "durationUs": int(round(duration_sec * 1_000_000)),
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

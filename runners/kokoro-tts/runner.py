#!/usr/bin/env python3
"""
Kokoro TTS runner - implements the OpenVideoMaker runner protocol
(NDJSON over stdio) for the audio.tts capability.

Model weights and voices arrive as local paths from the host (they were
fetched through the OpenVideoMaker artifact store); this adapter never
downloads anything itself.
"""
import json
import os
import sys

MODEL = None
DEVICE = "cpu"


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


def load_model(model_files):
    global MODEL, DEVICE
    from kokoro.model import KModel
    config_path = model_files.get("config", {}).get("path")
    model_path = model_files.get("model", {}).get("path")
    if not config_path or not model_path or not os.path.exists(config_path) or not os.path.exists(model_path):
        raise RuntimeError("model files missing: prepare must provide config + model paths")
    log("info", "loading Kokoro model from " + model_path)
    MODEL = KModel(repo_id="hexgrad/Kokoro-82M", config=config_path, model=model_path)


def run_tts(params):
    global MODEL
    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf

    import shutil
    text = str(params.get("settings", {}).get("text", ""))
    voice_path = params.get("inputs", {}).get("voice", {}).get("path")
    speed = float(params.get("settings", {}).get("speed", 1.0))
    output_dir = params.get("outputDir")
    if not text:
        raise RuntimeError("execute requires settings.text")
    if not voice_path or not os.path.exists(voice_path):
        raise RuntimeError("execute requires inputs.voice.path pointing at a voice file")
    os.makedirs(output_dir, exist_ok=True)
    # The store names files by content hash; kokoro requires a .pt suffix to
    # treat the voice as a local path, so materialize a copy.
    voice_local = os.path.join(output_dir, "voice.pt")
    shutil.copy(voice_path, voice_local)
    pipeline = KPipeline(lang_code="a", model=MODEL, trf=False)
    chunks = []
    total = None
    for i, (graphemes, phonemes, audio) in enumerate(pipeline(text, voice=voice_local, speed=speed)):
        if audio is not None:
            chunks.append(audio)
        send({"kind": "progress", "stage": "generating", "message": "chunk " + str(i + 1)})
    audio = np.concatenate(chunks)
    output_path = os.path.join(output_dir, "speech.wav")
    sf.write(output_path, audio, 24000)
    duration_us = int(len(audio) / 24000 * 1_000_000)
    log("info", "generated " + str(duration_us / 1_000_000) + "s of speech")
    return output_path, duration_us


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
                    "capabilities": ["audio.tts"],
                    "models": ["hf/hexgrad/Kokoro-82M"],
                    "runner": {"name": "kokoro-tts", "version": "0.1.0"},
                })
            elif method == "prepare":
                load_model(request.get("params", {}).get("modelFiles", {}))
                send({"id": request["id"], "ok": True, "estimate": {"note": "Kokoro-82M on " + DEVICE}})
            elif method == "execute":
                output_path, duration_us = run_tts(request.get("params", {}))
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {"audio": {"path": output_path}},
                    "metadata": {"durationUs": duration_us, "sampleRate": 24000, "capability": "audio.tts"},
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

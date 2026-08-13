#!/usr/bin/env python3
"""Fake runner for jobs tests: implements the runner protocol and
writes a tiny WAV so media probing works without any real model."""
import json
import math
import os
import queue
import struct
import sys
import threading
import time
import wave

cancel_flag = threading.Event()
incoming = queue.Queue()


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def reader():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            incoming.put(json.loads(line))
        except json.JSONDecodeError:
            send({"id": None, "ok": False, "error": {"code": "protocol", "message": "unparseable"}})


def make_wav(path, seconds, rate=16000):
    with wave.open(path, "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        frames = bytearray()
        count = int(rate * seconds)
        for i in range(count):
            value = int(12000 * math.sin(2 * math.pi * 440 * i / rate))
            frames += struct.pack("<h", value)
        wav.writeframes(bytes(frames))


def execute(params):
    settings = params.get("settings", {}) or {}
    output_dir = params.get("outputDir")
    if not output_dir:
        raise RuntimeError("execute requires outputDir")
    os.makedirs(output_dir, exist_ok=True)
    if settings.get("fail"):
        raise RuntimeError("requested failure")
    steps = int(settings.get("sleepSteps", 0))
    for i in range(steps):
        if cancel_flag.is_set():
            raise RuntimeError("cancelled")
        time.sleep(0.2)
        send({"kind": "progress", "stage": "working", "message": "step " + str(i + 1)})
    seconds = float(settings.get("seconds", 1.0))
    wav_path = os.path.join(output_dir, "out.wav")
    make_wav(wav_path, seconds)
    inputs = params.get("inputs", {}) or {}
    voice = inputs.get("voice") or {}
    data_path = os.path.join(output_dir, "out.json")
    with open(data_path, "w", encoding="utf-8") as fh:
        json.dump({
            "echo": settings.get("echo", ""),
            "inputKeys": sorted(inputs.keys()),
            "voicePath": voice.get("path") if isinstance(voice, dict) else None,
        }, fh)
    transcript_path = os.path.join(output_dir, "transcript.json")
    transcript = {
        "language": "en",
        "text": "hello world",
        "segments": [
            {"id": 0, "startMs": 0, "endMs": 500, "text": "hello"},
            {"id": 1, "startMs": 500, "endMs": 1000, "text": "world"},
        ],
    }
    with open(transcript_path, "w", encoding="utf-8") as fh:
        json.dump(transcript, fh)
    return (
        {"audio": {"path": wav_path}, "json": {"path": data_path}, "transcript": {"path": transcript_path}},
        {"durationUs": int(seconds * 1_000_000)},
    )


def prepare(params):
    files = params.get("modelFiles", {})
    model_path = files.get("model", {}).get("path")
    if not model_path or not os.path.exists(model_path):
        raise RuntimeError("prepare requires modelFiles.model.path")


def main():
    threading.Thread(target=reader, daemon=True).start()
    while True:
        request = incoming.get()
        method = request.get("method")
        try:
            if method == "describe":
                send({"id": request["id"], "ok": True, "protocolVersion": 1, "capabilities": ["audio.tts"], "models": ["http/test/model"], "runner": {"name": "fake-runner", "version": "0.1.0"}})
            elif method == "prepare":
                prepare(request.get("params", {}))
                send({"id": request["id"], "ok": True, "estimate": {"note": "fake"}})
            elif method == "execute":
                outputs, metadata = execute(request.get("params", {}))
                send({"id": request["id"], "ok": True, "outputs": outputs, "metadata": metadata})
            elif method == "health":
                send({"id": request["id"], "ok": True})
            elif method == "cancel":
                cancel_flag.set()
                send({"kind": "cancelled"})
            elif method == "dispose":
                send({"id": request["id"], "ok": True})
                break
            else:
                send({"id": request["id"], "ok": False, "error": {"code": "protocol", "message": "unknown method"}})
        except Exception as err:  # noqa: BLE001 - protocol boundary
            send({"id": request.get("id"), "ok": False, "error": {"code": "runner.failed", "message": str(err)}})


if __name__ == "__main__":
    main()

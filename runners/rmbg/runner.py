#!/usr/bin/env python3
"""
Background removal runner (media.background_remove) - IS-Net general
use (DIS) through ONNX Runtime, speaking the OpenVideoMaker runner
protocol (NDJSON over stdio).

The model file arrives as a local path from the host (fetched through
the OpenVideoMaker artifact store); this adapter never downloads
anything itself.

Preprocessing matches the upstream rembg DisSession contract for the
isnet-general-use.onnx weights (LANCZOS 1024x1024, divide by the
image max, per-channel (x - 0.5) / 1.0, CHW float32); the logits are
min-max normalized into an alpha matte and resized back. Heavy
imports happen at module level BEFORE the stdin loop: on Windows a
reader thread iterating stdin deadlocks numpy/onnxruntime imports.
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
import onnxruntime as ort

SESSION = None
DEVICE = "cpu"
INPUT_SIZE = (1024, 1024)


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


def load_model(model_files, device):
    global SESSION, DEVICE
    model_path = (model_files or {}).get("model", {}).get("path")
    if not model_path or not os.path.exists(model_path):
        raise RuntimeError("model files missing: prepare must provide modelFiles.model.path")
    DEVICE = device if device in ("cpu", "cuda") else "cpu"
    providers = (["CUDAExecutionProvider", "CPUExecutionProvider"] if DEVICE == "cuda" else ["CPUExecutionProvider"])
    log("info", "loading IS-Net session from " + model_path + " (" + DEVICE + ")")
    SESSION = ort.InferenceSession(model_path, providers=providers)
    log("info", "session ready; input " + SESSION.get_inputs()[0].name)


def remove_background(params):
    global SESSION
    image_path = ((params.get("inputs") or {}).get("image") or {}).get("path")
    output_dir = params.get("outputDir")
    if not image_path or not os.path.exists(image_path):
        raise RuntimeError("execute requires inputs.image.path pointing at a readable image")
    if not output_dir:
        raise RuntimeError("execute requires outputDir")
    os.makedirs(output_dir, exist_ok=True)
    started = time.time()
    send({"kind": "progress", "stage": "decoding", "message": "reading input image"})
    img = Image.open(image_path).convert("RGB")
    width, height = img.size

    send({"kind": "progress", "stage": "preprocessing", "message": "resizing to 1024x1024"})
    resized = img.resize(INPUT_SIZE, Image.Resampling.LANCZOS)
    im_ary = np.asarray(resized, dtype=np.float32)
    im_ary = im_ary / max(float(im_ary.max()), 1e-6)
    mean = np.array([0.5, 0.5, 0.5], dtype=np.float32)
    std = np.array([1.0, 1.0, 1.0], dtype=np.float32)
    normalized = (im_ary - mean) / std
    tensor = np.expand_dims(normalized.transpose((2, 0, 1)), 0).astype(np.float32)

    send({"kind": "progress", "stage": "inference", "message": "segmenting subject"})
    input_name = SESSION.get_inputs()[0].name
    outputs = SESSION.run(None, {input_name: tensor})
    pred = outputs[0][:, 0, :, :]
    lo = float(pred.min())
    hi = float(pred.max())
    pred = (pred - lo) / max(hi - lo, 1e-6)
    mask = Image.fromarray((np.squeeze(pred) * 255).astype("uint8"), mode="L")
    mask = mask.resize((width, height), Image.Resampling.LANCZOS)

    cutout = img.convert("RGBA")
    cutout.putalpha(mask)
    output_path = os.path.join(output_dir, "cutout.png")
    cutout.save(output_path, "PNG")
    elapsed_ms = int((time.time() - started) * 1000)
    log("info", "removed background in " + str(elapsed_ms) + "ms (" + str(width) + "x" + str(height) + ")")
    return output_path, elapsed_ms, width, height


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
                    "capabilities": ["media.background_remove"],
                    "models": ["gh/danielgatis/rembg-isnet-general-use"],
                    "runner": {"name": "rmbg", "version": "0.1.0"},
                })
            elif method == "prepare":
                params = request.get("params", {})
                load_model(params.get("modelFiles", {}), params.get("device", "cpu"))
                send({"id": request["id"], "ok": True, "estimate": {"note": "IS-Net general use on " + DEVICE}})
            elif method == "execute":
                output_path, elapsed_ms, width, height = remove_background(request.get("params", {}))
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {"image": {"path": output_path}},
                    "metadata": {"width": width, "height": height, "elapsedMs": elapsed_ms, "capability": "media.background_remove", "format": "png"},
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

#!/usr/bin/env python3
"""
Image upscaling runner (video.upscale) - Real-ESRGAN x4plus (RRDBNet,
BSD-3-Clause) speaking the OpenVideoMaker runner protocol (NDJSON
over stdio).

The model file arrives as a local path from the host (fetched through
the OpenVideoMaker artifact store); this adapter never downloads
anything itself. Heavy imports happen at module level BEFORE the stdin
loop (Windows import deadlock avoidance). Single images for now;
frame-by-frame video upscaling is future work.

The RRDBNet architecture below is reproduced from xinntao/Real-ESRGAN
(BSD-3-Clause, basicsr/archs/rrdbnet_arch.py) so the runtime needs only
torch - upstream's basicsr package is stale against current torchvision.
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F

MODEL = None
DEVICE_NAME = "cpu"
SCALE = 4


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, num_feat, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, scale=4, num_feat=64, num_block=23, num_grow_ch=32):
        super().__init__()
        self.scale = scale
        if scale == 2:
            num_in_ch = num_in_ch * 4
        elif scale == 1:
            num_in_ch = num_in_ch * 16
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out


def load_model(model_files, device):
    global MODEL, DEVICE_NAME
    model_path = (model_files or {}).get("model", {}).get("path")
    if not model_path or not os.path.exists(model_path):
        raise RuntimeError("model files missing: prepare must provide modelFiles.model.path")
    device_name = device if device in ("cpu", "cuda") else ("cuda" if torch.cuda.is_available() else "cpu")
    if device_name == "cuda" and not torch.cuda.is_available():
        device_name = "cpu"
        log("info", "CUDA requested but this torch build has no CUDA - falling back to CPU")
    log("info", "loading Real-ESRGAN x4plus from " + model_path + " (" + device_name + ")")
    state = torch.load(model_path, map_location="cpu", weights_only=True)
    weights = state.get("params_ema") or state.get("params")
    if weights is None:
        raise RuntimeError("unexpected checkpoint layout")
    MODEL = RRDBNet(num_in_ch=3, num_out_ch=3, scale=SCALE)
    MODEL.load_state_dict(weights, strict=True)
    MODEL.to(torch.device(device_name))
    MODEL.eval()
    DEVICE_NAME = device_name
    log("info", "upscaler ready")


def upscale_image(params):
    global MODEL
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
    img = np.array(img).astype(np.float32) / 255.0
    tensor = torch.from_numpy(np.transpose(img[:, :, [2, 1, 0]], (2, 0, 1))).float()
    tensor = tensor.unsqueeze(0).to(torch.device(DEVICE_NAME))
    _, _, h, w = tensor.size()
    pad_h = (SCALE - h % SCALE) % SCALE
    pad_w = (SCALE - w % SCALE) % SCALE
    tensor = F.pad(tensor, (0, pad_w, 0, pad_h), 'reflect')

    send({"kind": "progress", "stage": "inference", "message": "upscaling"})
    with torch.no_grad():
        output = MODEL(tensor)
    output = output.data.squeeze().float().clamp_(0, 1).cpu().numpy()
    output = np.transpose(output[[2, 1, 0], :, :], (1, 2, 0))
    output = (output * 255.0).round().astype(np.uint8)
    output = output[0 : height * SCALE, 0 : width * SCALE, :]
    result = Image.fromarray(output)
    output_path = os.path.join(output_dir, "upscaled.png")
    result.save(output_path, "PNG")
    elapsed_ms = int((time.time() - started) * 1000)
    log("info", "upscaled " + str(width) + "x" + str(height) + " -> " + str(result.width) + "x" + str(result.height) + " in " + str(elapsed_ms) + "ms")
    return output_path, elapsed_ms, result.width, result.height


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
                    "capabilities": ["video.upscale"],
                    "models": ["gh/xinntao/Real-ESRGAN-x4plus"],
                    "runner": {"name": "upscale", "version": "0.1.0"},
                })
            elif method == "prepare":
                params = request.get("params", {})
                load_model(params.get("modelFiles", {}), params.get("device", "auto"))
                send({"id": request["id"], "ok": True, "estimate": {"note": "Real-ESRGAN x4plus on " + DEVICE_NAME}})
            elif method == "execute":
                output_path, elapsed_ms, width, height = upscale_image(request.get("params", {}))
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {"image": {"path": output_path}},
                    "metadata": {"width": width, "height": height, "elapsedMs": elapsed_ms, "capability": "video.upscale", "format": "png"},
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

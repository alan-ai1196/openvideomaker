#!/usr/bin/env python3
"""
LatentSync runner - implements the OpenVideoMaker runner protocol
(NDJSON over stdio) for the avatar.lip_sync capability.

Weights arrive as local paths from the host (they were fetched through
the OpenVideoMaker artifact store); this adapter never downloads
anything. The inference path is a faithful, hermetic reimplementation
of the upstream scripts/inference.py entrypoint over the vendored
LatentSync package (Apache-2.0, pinned upstream commit
a229c3948406bc2cf6eaf4873e662e70c6a04746; see vendor/ and README.md).
"""
import json
import math
import os
import queue
import shutil
import sys
import tempfile
import threading
import zipfile

# The vendored upstream package lives next to this adapter.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))

# NOTE (Windows): every heavy import happens HERE, at module level, before
# the stdin reader thread starts. Importing torch/numpy while another
# thread iterates sys.stdin deadlocks on Windows (OpenBLAS console-handle
# init during import) - reproduced with a minimal probe, so never move
# these imports below main().
import torch  # noqa: E402
from omegaconf import OmegaConf  # noqa: E402
from diffusers import AutoencoderKL, DDIMScheduler  # noqa: E402
from accelerate.utils import set_seed  # noqa: E402
from latentsync.models.unet import UNet3DConditionModel  # noqa: E402
from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline  # noqa: E402
from latentsync.whisper.audio2feature import Audio2Feature  # noqa: E402

MODEL = None
AUX_ROOT = None
CANCEL = threading.Event()
incoming = queue.Queue()


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def log(level, message):
    send({"kind": "log", "level": level, "message": message})


def reader():
    """Single stdin consumer: cancel aborts in-flight work immediately;
    every other request is queued for the main loop."""
    global CANCEL
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            send({"id": None, "ok": False, "error": {"code": "protocol", "message": "unparseable request"}})
            continue
        if request.get("method") == "cancel":
            CANCEL.set()
            send({"kind": "cancelled"})
        else:
            incoming.put(request)


def ensure_aux(model_files):
    """Unpack buffalo_l.zip once so insightface finds its ONNX models
    locally and never downloads them at runtime. insightface 0.7.3
    resolves detection/landmark models at root/models/buffalo_l/*.onnx,
    so the top-level zip entries land in exactly that directory."""
    zip_path = (model_files.get("aux_zip") or {}).get("path")
    if not zip_path or not os.path.exists(zip_path):
        raise RuntimeError("model files missing: prepare must provide aux_zip path")
    aux_root = os.path.join(tempfile.gettempdir(), "ovm-latentsync-aux-" + str(os.path.getsize(zip_path)))
    model_dir = os.path.join(aux_root, "models", "buffalo_l")
    marker = os.path.join(model_dir, ".ovm-ready")
    if os.path.exists(marker):
        return aux_root
    os.makedirs(model_dir, exist_ok=True)
    tmp_dir = os.path.join(aux_root, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmp_dir)
    for base, _dirs, files in os.walk(tmp_dir):
        for name in files:
            if name.endswith(".onnx"):
                shutil.move(os.path.join(base, name), os.path.join(model_dir, name))
    shutil.rmtree(tmp_dir, ignore_errors=True)
    with open(marker, "w", encoding="utf-8") as fh:
        fh.write(zip_path)
    return aux_root


def load_model(model_files):
    global MODEL
    for key in ("unet", "whisper", "vae_config", "vae_model"):
        path = (model_files.get(key) or {}).get("path")
        if not path or not os.path.exists(path):
            raise RuntimeError("model files missing: " + key)
    here = os.path.dirname(os.path.abspath(__file__))
    vendor = os.path.join(here, "vendor")
    config = OmegaConf.load(os.path.join(vendor, "configs", "stage2_512.yaml"))
    config.data.mask_image_path = os.path.join(vendor, "mask.png")
    if not torch.cuda.is_available():
        raise RuntimeError("LatentSync requires a CUDA GPU")
    dtype = torch.float16 if torch.cuda.get_device_capability()[0] > 7 else torch.float32
    log("info", "loading whisper tiny encoder")
    scheduler = DDIMScheduler.from_pretrained(os.path.join(vendor, "configs"))
    audio_encoder = Audio2Feature(
        model_path=model_files["whisper"]["path"],
        device="cuda",
        num_frames=config.data.num_frames,
        audio_feat_length=config.data.audio_feat_length,
    )
    # The VAE files are content-addressed store paths; materialize them
    # under the names diffusers expects, once per runtime.
    vae_dir = os.path.join(tempfile.gettempdir(), "ovm-latentsync-vae")
    os.makedirs(vae_dir, exist_ok=True)
    if not os.path.exists(os.path.join(vae_dir, "config.json")):
        shutil.copy(model_files["vae_config"]["path"], os.path.join(vae_dir, "config.json"))
    if not os.path.exists(os.path.join(vae_dir, "diffusion_pytorch_model.safetensors")):
        shutil.copy(model_files["vae_model"]["path"], os.path.join(vae_dir, "diffusion_pytorch_model.safetensors"))
    log("info", "loading SD VAE")
    vae = AutoencoderKL.from_pretrained(vae_dir, torch_dtype=dtype)
    vae.config.scaling_factor = 0.18215
    vae.config.shift_factor = 0
    log("info", "loading LatentSync UNet")
    unet, _ = UNet3DConditionModel.from_pretrained(
        OmegaConf.to_container(config.model), model_files["unet"]["path"], device="cpu"
    )
    unet = unet.to(dtype=dtype)
    MODEL = {
        "config": config,
        "pipeline": LipsyncPipeline(vae=vae, audio_encoder=audio_encoder, unet=unet, scheduler=scheduler).to("cuda"),
        "dtype": dtype,
        "vendor": vendor,
    }
    log("info", "model ready on " + torch.cuda.get_device_name(0))


def run_lipsync(params, aux_root):
    global MODEL, CANCEL
    CANCEL.clear()
    video_path = (params.get("inputs") or {}).get("video", {}).get("path")
    audio_path = (params.get("inputs") or {}).get("audio", {}).get("path")
    output_dir = params.get("outputDir")
    if not video_path or not os.path.exists(video_path):
        raise RuntimeError("execute requires inputs.video.path")
    if not audio_path or not os.path.exists(audio_path):
        raise RuntimeError("execute requires inputs.audio.path")
    if not output_dir:
        raise RuntimeError("execute requires outputDir")
    os.makedirs(output_dir, exist_ok=True)
    # Upstream read_video resamples into a CWD-relative 'temp' dir; keep
    # that scratch inside the job's output directory.
    os.chdir(output_dir)
    settings = params.get("settings") or {}
    num_steps = int(settings.get("inference_steps", 20))
    guidance = float(settings.get("guidance_scale", 1.5))
    seed = int(settings.get("seed", -1))
    deepcache = bool(settings.get("deepcache", True))
    pipeline = MODEL["pipeline"]
    if deepcache:
        from DeepCache import DeepCacheSDHelper
        helper = DeepCacheSDHelper(pipe=pipeline)
        helper.set_params(cache_interval=3, cache_branch_id=0)
        helper.enable()
    if seed == -1:
        torch.seed()
    else:
        set_seed(seed)
    os.environ["OVM_AUX_DIR"] = aux_root
    # Chunk count drives honest progress: steps = chunks x inference_steps.
    feature = MODEL["pipeline"].audio_encoder.audio2feat(audio_path)
    chunks = MODEL["pipeline"].audio_encoder.feature2chunks(feature_array=feature, fps=25)
    num_chunks = math.ceil(len(chunks) / MODEL["config"].data.num_frames)
    total_steps = max(1, num_chunks * num_steps)
    state = {"chunk": 0, "done": 0}

    def on_step(j, _t, _latents):
        if CANCEL.is_set():
            raise RuntimeError("cancelled")
        if j == 0:
            state["chunk"] += 1
        state["done"] += 1
        send({
            "kind": "progress",
            "stage": "inferring",
            "message": "chunk " + str(state["chunk"]) + "/" + str(num_chunks),
            "progress": min(1.0, state["done"] / total_steps),
        })

    video_out = os.path.join(output_dir, "out.mp4")
    log("info", "running lip sync: " + str(num_chunks) + " chunks, " + str(num_steps) + " steps")
    pipeline(
        video_path=video_path,
        audio_path=audio_path,
        video_out_path=video_out,
        num_frames=MODEL["config"].data.num_frames,
        num_inference_steps=num_steps,
        guidance_scale=guidance,
        weight_dtype=MODEL["dtype"],
        width=MODEL["config"].data.resolution,
        height=MODEL["config"].data.resolution,
        mask_image_path=MODEL["config"].data.mask_image_path,
        temp_dir=os.path.join(output_dir, "temp"),
        callback=on_step,
        callback_steps=1,
    )
    if CANCEL.is_set():
        raise RuntimeError("cancelled")
    return video_out


def main():
    threading.Thread(target=reader, daemon=True).start()
    while True:
        request = incoming.get()
        method = request.get("method")
        try:
            if method == "describe":
                send({
                    "id": request["id"], "ok": True, "protocolVersion": 1,
                    "capabilities": ["avatar.lip_sync"],
                    "models": ["hf/bytedance/latentsync-1.5"],
                    "runner": {"name": "latentsync", "version": "0.1.0"},
                })
            elif method == "prepare":
                global AUX_ROOT
                model_files = request.get("params", {}).get("modelFiles", {})
                load_model(model_files)
                AUX_ROOT = ensure_aux(model_files)
                send({"id": request["id"], "ok": True, "estimate": {"note": "LatentSync 1.5, CUDA fp16, 512px"}})
            elif method == "execute":
                if AUX_ROOT is None:
                    raise RuntimeError("prepare must run before execute")
                video_out = run_lipsync(request.get("params", {}), AUX_ROOT)
                send({
                    "id": request["id"], "ok": True,
                    "outputs": {"video": {"path": video_out}},
                    "metadata": {"fps": 25, "resolution": MODEL["config"].data.resolution, "capability": "avatar.lip_sync"},
                })
            elif method == "health":
                send({"id": request["id"], "ok": True})
            elif method == "cancel":
                CANCEL.set()
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

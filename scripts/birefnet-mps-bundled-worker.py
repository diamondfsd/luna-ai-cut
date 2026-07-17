#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path

import numpy
import torch
import torch.nn.functional as functional
from safetensors.torch import load_file
from model.BiRefNet_config import BiRefNetConfig
from model.birefnet import BiRefNet


MODEL_ROOT = Path(os.environ["LUNA_BIREFNET_MPS_MODEL"]).resolve()
model = None


def reply(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def load_model():
    global model
    if model is not None:
        return 0
    started = time.perf_counter()
    if not torch.backends.mps.is_available():
        raise RuntimeError("MPS is unavailable")
    instance = BiRefNet(config=BiRefNetConfig(bb_pretrained=False))
    instance.load_state_dict(load_file(MODEL_ROOT / "model.safetensors"))
    instance.to("mps").eval()
    model = instance
    return round((time.perf_counter() - started) * 1000)


for line in sys.stdin:
    command = {}
    try:
        command = json.loads(line)
        request_id = str(command.get("id", ""))
        if command.get("op") == "ping":
            reply({"kind": "pong", "id": request_id})
            continue
        if command.get("op") == "shutdown":
            reply({"kind": "pong", "id": request_id})
            break
        if command.get("op") != "segment" or command.get("backend") != "birefnet-general-lite":
            raise ValueError("Unsupported command")
        reused = model is not None
        load_ms = load_model()
        rgb = numpy.fromfile(command["inputPath"], dtype=numpy.uint8)
        if rgb.size != 1024 * 1024 * 3:
            raise ValueError("Invalid RGB input size")
        rgb = rgb.reshape((1024, 1024, 3)).copy()
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255)
        tensor = tensor.sub_(torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1))
        tensor = tensor.div_(torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)).unsqueeze(0).to("mps")
        torch.mps.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            prediction = model(tensor)[-1].sigmoid()
            prediction = functional.interpolate(
                prediction,
                size=(command["outputSize"], command["outputSize"]),
                mode="bilinear",
                align_corners=False,
            )
        torch.mps.synchronize()
        inference_ms = round((time.perf_counter() - started) * 1000)
        mask = prediction[0, 0].detach().clamp(0, 1).mul(255).cpu().numpy()
        mask = numpy.floor(mask + 0.5).astype(numpy.uint8)
        Path(command["outputPath"]).write_bytes(mask.tobytes())
        reply({
            "kind": "result",
            "id": request_id,
            "sessionLoadMs": load_ms,
            "inferenceMs": inference_ms,
            "sessionReused": reused,
        })
    except Exception as error:
        reply({"kind": "error", "id": str(command.get("id", "")), "error": str(error)})

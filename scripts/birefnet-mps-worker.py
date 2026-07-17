#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path


MODEL_ID = "ZhengPeng7/BiRefNet_lite"
INPUT_SIZE = 1024


class BiRefNetMpsSession:
    def __init__(self) -> None:
        self.model = None
        self.torch = None
        self.functional = None
        self.numpy = None

    def load(self) -> int:
        if self.model is not None:
            return 0
        started = time.perf_counter()
        import numpy
        import torch
        import torch.nn.functional as functional
        from transformers import AutoModelForImageSegmentation

        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS is unavailable")
        model_source = os.environ.get("LUNA_BIREFNET_MPS_MODEL", MODEL_ID)
        model = AutoModelForImageSegmentation.from_pretrained(
            model_source,
            trust_remote_code=True,
            local_files_only=True,
        )
        model.to(torch.device("mps"))
        model.eval()
        self.model = model
        self.torch = torch
        self.functional = functional
        self.numpy = numpy
        return round((time.perf_counter() - started) * 1000)

    def segment(self, input_path: str, output_path: str, output_size: int) -> tuple[int, int]:
        torch = self.torch
        numpy = self.numpy
        if self.model is None or torch is None or self.functional is None or numpy is None:
            raise RuntimeError("MPS model is not loaded")
        rgb = numpy.fromfile(input_path, dtype=numpy.uint8)
        if rgb.size != INPUT_SIZE * INPUT_SIZE * 3:
            raise ValueError(f"Invalid RGB input size: {rgb.size}")
        rgb = rgb.reshape((INPUT_SIZE, INPUT_SIZE, 3)).copy()
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0)
        mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        deviation = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
        tensor = tensor.sub_(mean).div_(deviation).unsqueeze(0).to("mps")
        torch.mps.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            prediction = self.model(tensor)[-1].sigmoid()
            prediction = self.functional.interpolate(
                prediction,
                size=(output_size, output_size),
                mode="bilinear",
                align_corners=False,
            )
        torch.mps.synchronize()
        inference_ms = round((time.perf_counter() - started) * 1000)
        mask = prediction[0, 0].detach().clamp(0, 1).mul(255).cpu().numpy()
        mask = numpy.floor(mask + 0.5).astype(numpy.uint8)
        Path(output_path).write_bytes(mask.tobytes())
        return inference_ms, mask.size


def response(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def run_server() -> None:
    session = BiRefNetMpsSession()
    for line in sys.stdin:
        command = {}
        try:
            command = json.loads(line)
            request_id = str(command.get("id", ""))
            operation = command.get("op")
            if operation == "ping":
                response({"kind": "pong", "id": request_id})
                continue
            if operation == "shutdown":
                response({"kind": "pong", "id": request_id})
                return
            if operation != "segment" or command.get("backend") != "birefnet-general-lite":
                raise ValueError("Unsupported MPS worker command")
            reused = session.model is not None
            load_ms = session.load()
            inference_ms, output_bytes = session.segment(
                str(command["inputPath"]),
                str(command["outputPath"]),
                int(command["outputSize"]),
            )
            if output_bytes != int(command["outputSize"]) ** 2:
                raise ValueError("Invalid MPS mask size")
            response(
                {
                    "kind": "result",
                    "id": request_id,
                    "sessionLoadMs": load_ms,
                    "inferenceMs": inference_ms,
                    "sessionReused": reused,
                }
            )
        except Exception as error:
            response(
                {
                    "kind": "error",
                    "id": str(command.get("id", "")),
                    "error": str(error),
                }
            )


if __name__ == "__main__":
    if sys.argv[1:] != ["--server"]:
        raise SystemExit("Usage: birefnet-mps-worker.py --server")
    run_server()

#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import platform
import resource
import statistics
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as functional
from transformers import AutoModelForImageSegmentation


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = REPOSITORY_ROOT / "test-data" / "color-masking" / "d3-effect-set"
DEFAULT_MODEL = "ZhengPeng7/BiRefNet_lite"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def rounded(value: float) -> float:
    return round(value * 1000, 2)


def comparison(mask: np.ndarray, reference_path: Path | None) -> dict:
    if reference_path is None or not reference_path.exists():
        return {
            "referenceSha256": None,
            "meanAbsoluteAlphaDifference": None,
            "maxAlphaDifference": None,
            "thresholdDisagreementRatio": None,
            "foregroundIntersectionOverUnion": None,
        }
    reference = np.fromfile(reference_path, dtype=np.uint8)
    if reference.size != mask.size:
        raise ValueError(f"Reference mask has invalid size: {reference_path}")
    reference = reference.reshape(mask.shape)
    difference = np.abs(mask.astype(np.int16) - reference.astype(np.int16))
    foreground = mask >= 128
    reference_foreground = reference >= 128
    union = np.logical_or(foreground, reference_foreground).sum()
    intersection = np.logical_and(foreground, reference_foreground).sum()
    return {
        "referenceSha256": sha256(reference_path),
        "meanAbsoluteAlphaDifference": round(float(difference.mean()), 6),
        "maxAlphaDifference": int(difference.max()),
        "thresholdDisagreementRatio": round(float(np.not_equal(foreground, reference_foreground).mean()), 6),
        "foregroundIntersectionOverUnion": round(float(intersection / union), 6) if union else 1.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate BiRefNet PyTorch MPS on Luna's fixed subject set.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", required=True)
    parser.add_argument("--reference-dir")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--allow-download", action="store_true")
    args = parser.parse_args()

    if not torch.backends.mps.is_available():
        raise SystemExit("MPS is unavailable in this Python environment")

    output_root = Path(args.output).resolve()
    mask_root = output_root / "masks" / "subject"
    output_root.mkdir(parents=True, exist_ok=True)
    mask_root.mkdir(parents=True, exist_ok=True)
    reference_root = Path(args.reference_dir).resolve() if args.reference_dir else None
    manifest_path = DATASET_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    items = [item for item in manifest["items"] if item["target"] == "subject"]

    device = torch.device("mps")
    load_started = time.perf_counter()
    model = AutoModelForImageSegmentation.from_pretrained(
        args.model,
        trust_remote_code=True,
        local_files_only=not args.allow_download,
    )
    model.to(device)
    model.eval()
    model_load_ms = rounded(time.perf_counter() - load_started)

    warmup_started = time.perf_counter()
    with torch.inference_mode():
        model(torch.zeros((1, 3, 1024, 1024), device=device))
    torch.mps.synchronize()
    warmup_ms = rounded(time.perf_counter() - warmup_started)

    results = []
    for item in items:
        total_started = time.perf_counter()
        prepare_started = time.perf_counter()
        completed = subprocess.run(
            [
                args.ffmpeg,
                "-v",
                "error",
                "-i",
                str(DATASET_ROOT / item["file"]),
                "-vf",
                "scale=1024:1024:flags=bilinear",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        )
        rgb = np.frombuffer(completed.stdout, dtype=np.uint8)
        if rgb.size != 1024 * 1024 * 3:
            raise ValueError(f"FFmpeg returned invalid RGB data for {item['id']}")
        rgb = rgb.reshape((1024, 1024, 3)).copy()
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0)
        mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        standard_deviation = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
        tensor = tensor.sub_(mean).div_(standard_deviation).unsqueeze(0)
        image_prepare_ms = rounded(time.perf_counter() - prepare_started)

        transfer_started = time.perf_counter()
        tensor = tensor.to(device)
        torch.mps.synchronize()
        transfer_ms = rounded(time.perf_counter() - transfer_started)

        inference_started = time.perf_counter()
        with torch.inference_mode():
            prediction = model(tensor)[-1].sigmoid()
            prediction = functional.interpolate(
                prediction,
                size=(512, 512),
                mode="bilinear",
                align_corners=False,
            )
        torch.mps.synchronize()
        inference_ms = rounded(time.perf_counter() - inference_started)

        postprocess_started = time.perf_counter()
        mask = np.rint(
            prediction[0, 0].detach().clamp(0, 1).mul(255).cpu().numpy()
        ).astype(np.uint8)
        postprocess_ms = rounded(time.perf_counter() - postprocess_started)
        mask_path = mask_root / f"{item['id']}.mask"
        mask.tofile(mask_path)
        foreground_ratio = float((mask >= 128).mean())
        reference_path = reference_root / f"{item['id']}.mask" if reference_root else None
        results.append(
            {
                "imageId": item["id"],
                "status": "success" if foreground_ratio > 0.0005 else "empty",
                "imagePrepareMs": image_prepare_ms,
                "transferMs": transfer_ms,
                "inferenceMs": inference_ms,
                "postprocessMs": postprocess_ms,
                "totalMs": rounded(time.perf_counter() - total_started),
                "foregroundRatio": round(foreground_ratio, 6),
                "outputSha256": sha256(mask_path),
                **comparison(mask, reference_path),
            }
        )
        print(json.dumps(results[-1], ensure_ascii=True), flush=True)

    total_times = [result["totalMs"] for result in results]
    inference_times = [result["inferenceMs"] for result in results]
    summary = {
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "torch": torch.__version__,
            "mpsAvailable": torch.backends.mps.is_available(),
        },
        "model": args.model,
        "datasetManifestSha256": sha256(manifest_path),
        "modelLoadMs": model_load_ms,
        "warmupMs": warmup_ms,
        "peakResidentBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "successCount": sum(result["status"] == "success" for result in results),
        "inferenceP50Ms": round(statistics.median(inference_times), 2),
        "inferenceP95Ms": round(percentile(inference_times, 0.95), 2),
        "totalP50Ms": round(statistics.median(total_times), 2),
        "totalP95Ms": round(percentile(total_times, 0.95), 2),
        "results": results,
    }
    (output_root / "results.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (output_root / "results.csv").open("w", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print(json.dumps({key: value for key, value in summary.items() if key != "results"}, indent=2))


if __name__ == "__main__":
    main()

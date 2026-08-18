"""Stable Audio 3 TFLite model manifest and domestic downloader.

The application keeps model files outside the packaged application.  Every file
is downloaded from the fixed ModelScope revision and is accepted only when both
the byte count and SHA256 match this manifest.
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

REPO_ID = "stabilityai/stable-audio-3-optimized"
MODEL_REVISION = "cbf2601200b531a8304eb21a360a1a5ba371a10c"
MODELSCOPE_BASE = (
    f"https://www.modelscope.cn/models/{REPO_ID}/resolve/{MODEL_REVISION}"
)

SOURCE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE_ROOT = Path(
    os.environ.get("SA3_CACHE_ROOT", str(SOURCE_ROOT))
).resolve()
MODEL_ROOT = Path(os.environ.get("SA3_MODEL_ROOT", str(DEFAULT_CACHE_ROOT))).resolve()
DOWNLOAD_ROOT = Path(
    os.environ.get("SA3_DOWNLOAD_ROOT", str(MODEL_ROOT / "downloads"))
).resolve()

ProgressCallback = Callable[[str, int, int], None]


def _file(local_rel: str, remote_rel: str, size: int, sha256: str) -> dict[str, object]:
    return {
        "local": local_rel,
        "remote": remote_rel,
        "size": size,
        "sha256": sha256,
        "url": f"{MODELSCOPE_BASE}/{remote_rel}",
    }


FILES: dict[str, dict[str, object]] = {
    "tokenizer": _file(
        "models/tokenizer.model",
        "tokenizer.model",
        4_241_003,
        "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2",
    ),
    "t5": _file(
        "models/tflite/t5gemma/encoder_fp16.tflite",
        "tflite/t5gemma/encoder_fp16.tflite",
        563_818_608,
        "8530d0b3e6b9b9dcf1239145c2a853fb749708eaddbb472ff8f0802b50059372",
    ),
    "music_dit": _file(
        "models/tflite/sa3-sm-music/dit_fp32.tflite",
        "tflite/sa3-sm-music/dit_fp32.tflite",
        1_838_758_544,
        "d388700a2ca439c11e9a53506e964e93231386a2beb8173c6eec6d95f676ce09",
    ),
    "sfx_dit": _file(
        "models/tflite/sa3-sm-sfx/dit_fp32.tflite",
        "tflite/sa3-sm-sfx/dit_fp32.tflite",
        1_838_758_544,
        "6060ecfeca34c4ab35bc1912a37e680e8cd7aab6c4bd9de1bc2655414891b8d8",
    ),
    "same_s_encoder": _file(
        "models/tflite/same-s/enc_fp32.tflite",
        "tflite/same-s/enc_fp32.tflite",
        215_195_204,
        "35ce38ea9f56e116036c683e37bf96c954d4fe0a435606ded0f62595b91f52a3",
    ),
    "same_s_decoder": _file(
        "models/tflite/same-s/dec_fp32.tflite",
        "tflite/same-s/dec_fp32.tflite",
        218_377_156,
        "cd87fa6686b24a56dc3497e05fbb26a34cf9604afe49c6631e829c9e70fccf21",
    ),
}

MODEL_FILES = {
    "small-music": ("music_dit", "same_s_encoder", "same_s_decoder"),
    "small-sfx": ("sfx_dit", "same_s_encoder", "same_s_decoder"),
}

# Keep the official names available for the copied CLI and documentation.
DIT_SUBDIR = {"sm-music": "sa3-sm-music", "sm-sfx": "sa3-sm-sfx"}
PRECISIONS = ("fp32",)
DIT_BUNDLES = {
    "sm-music": [(FILES["music_dit"]["local"], FILES["music_dit"]["remote"])],
    "sm-sfx": [(FILES["sfx_dit"]["local"], FILES["sfx_dit"]["remote"])],
}
SHARED = [
    (FILES["tokenizer"]["local"], FILES["tokenizer"]["remote"]),
    (FILES["t5"]["local"], FILES["t5"]["remote"]),
    (FILES["same_s_encoder"]["local"], FILES["same_s_encoder"]["remote"]),
    (FILES["same_s_decoder"]["local"], FILES["same_s_decoder"]["remote"]),
]
BUNDLE_SIZES = {
    "sm-music": "2.8 GB (small music + shared T5Gemma/SAME-S)",
    "sm-sfx": "2.8 GB (small sfx + shared T5Gemma/SAME-S)",
}

FLAT_MANIFEST = {
    str(item["local"]): item for item in FILES.values()
}


def dit_rel(dit: str, precision: str = "fp32") -> str:
    if precision != "fp32":
        raise ValueError("Luna Stable Audio runtime currently uses fp32 TFLite models")
    if dit == "sm-music":
        return str(FILES["music_dit"]["local"])
    if dit == "sm-sfx":
        return str(FILES["sfx_dit"]["local"])
    raise ValueError(f"Unsupported DiT model: {dit}")


def dec_rel(dec: str, precision: str = "fp32") -> str:
    if dec != "same-s" or precision != "fp32":
        raise ValueError("Luna Stable Audio runtime currently uses the fp32 SAME-S decoder")
    return str(FILES["same_s_decoder"]["local"])


def enc_rel(dec: str, precision: str = "fp32") -> str:
    if dec != "same-s" or precision != "fp32":
        raise ValueError("Luna Stable Audio runtime currently uses the fp32 SAME-S encoder")
    return str(FILES["same_s_encoder"]["local"])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_valid(path: Path, spec: dict[str, object]) -> bool:
    try:
        return (
            path.is_file()
            and path.stat().st_size == int(spec["size"])
            and _sha256(path) == str(spec["sha256"])
        )
    except OSError:
        return False


def _download(spec: dict[str, object], target: Path, on_progress: ProgressCallback | None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    local_rel = Path(str(spec["local"]))
    partial = DOWNLOAD_ROOT / local_rel.parent / f".{local_rel.name}.download"
    partial.parent.mkdir(parents=True, exist_ok=True)
    expected_size = int(spec["size"])
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > expected_size:
        partial.unlink(missing_ok=True)
        offset = 0

    request = urllib.request.Request(str(spec["url"]))
    if offset:
        request.add_header("Range", f"bytes={offset}-")
    try:
        response = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        if offset and error.code == 416:
            partial.unlink(missing_ok=True)
            return _download(spec, target, on_progress)
        raise

    append = offset > 0 and response.status == 206
    if not append:
        offset = 0
    completed = offset
    mode = "ab" if append else "wb"
    with response, partial.open(mode) as stream:
        while True:
            chunk = response.read(4 * 1024 * 1024)
            if not chunk:
                break
            completed += len(chunk)
            if completed > expected_size:
                raise RuntimeError(f"Model download is larger than the registered size: {target.name}")
            stream.write(chunk)
            stream.flush()
            if on_progress:
                on_progress(str(spec["local"]), completed, expected_size)

    if completed != expected_size or _sha256(partial) != str(spec["sha256"]):
        raise RuntimeError(f"Model verification failed for {target.name} (size or SHA256 mismatch)")
    partial.replace(target)


def ensure_local(
    local_rel_path: str,
    verbose: bool = True,
    on_progress: ProgressCallback | None = None,
) -> Path:
    spec = FLAT_MANIFEST.get(local_rel_path)
    if spec is None:
        raise FileNotFoundError(f"Model file is not in the fixed manifest: {local_rel_path}")
    target = MODEL_ROOT / local_rel_path
    if _is_valid(target, spec):
        if on_progress:
            on_progress(local_rel_path, int(spec["size"]), int(spec["size"]))
        return target
    if target.exists():
        target.unlink()
    if verbose:
        print(
            f"[stable-audio] downloading {local_rel_path} from ModelScope",
            file=sys.stderr if os.environ.get("SA3_JSONL") == "1" else sys.stdout,
            flush=True,
        )
    _download(spec, target, on_progress)
    return target


def ensure_model(
    model: str,
    verbose: bool = True,
    on_progress: ProgressCallback | None = None,
) -> list[Path]:
    if model not in MODEL_FILES:
        raise ValueError(f"Unsupported Stable Audio model: {model}")
    paths: list[Path] = []
    for key in ("tokenizer", "t5", *MODEL_FILES[model]):
        paths.append(ensure_local(
            str(FILES[key]["local"]),
            verbose=verbose,
            on_progress=on_progress,
        ))
    return paths


def is_present(local_rel_path: str) -> bool:
    spec = FLAT_MANIFEST.get(local_rel_path)
    return bool(spec and _is_valid(MODEL_ROOT / local_rel_path, spec))


def bundle_status(bundle: str) -> tuple[int, int]:
    if bundle not in ("sm-music", "sm-sfx"):
        raise ValueError(f"Unsupported bundle: {bundle}")
    model = "small-music" if bundle == "sm-music" else "small-sfx"
    required = ["tokenizer", "t5", *MODEL_FILES[model]]
    present = sum(is_present(str(FILES[key]["local"])) for key in required)
    return present, len(required)


if __name__ == "__main__":
    print("Stable Audio 3 TFLite model manifest")
    print(f"ModelScope revision: {MODEL_REVISION}")
    print(f"Cache root: {MODEL_ROOT}")
    print(f"Python: {sys.version.split()[0]}")

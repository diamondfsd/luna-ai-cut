"""Long-lived Stable Audio 3 service used by Luna AI Cut.

The process speaks JSON Lines on stdin/stdout. Model files, the virtual
environment, generated files and all runtime caches are selected by the host
through ``SA3_MODEL_ROOT`` and ``SA3_WORK_ROOT``; no user data is written next
to the packaged application.
"""

from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import traceback
import wave
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO = SCRIPTS_DIR.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(SCRIPTS_DIR))

from sa3_gradio import run_generation  # noqa: E402
from weights import ensure_model  # noqa: E402

MODEL_MAP = {
    "small-music": "sm-music",
    "small-sfx": "sm-sfx",
}
SAMPLE_RATE = 44_100
MAX_SECONDS = 30
MIN_SECONDS = 2
DEFAULT_STEPS = 8
THREADS = max(1, int(os.environ.get("SA3_THREADS", "8")))


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, request: dict[str, object]) -> None:
        self.request = request
        self.cancelled = threading.Event()


commands: queue.Queue[dict[str, object]] = queue.Queue()
output_lock = threading.Lock()
active_job: Job | None = None


def emit(payload: dict[str, object]) -> None:
    with output_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def stdin_reader() -> None:
    for line in sys.stdin:
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            emit({"type": "error", "requestId": None, "message": f"Invalid request: {error}"})
            continue
        if isinstance(value, dict):
            commands.put(value)
    commands.put({"type": "shutdown"})


def progress(job: Job, stage: str, fraction: float | None = None,
             file: str | None = None, loaded: int | None = None,
             total: int | None = None) -> None:
    if job.cancelled.is_set():
        raise Cancelled()
    emit({
        "type": "progress",
        "requestId": job.request.get("requestId"),
        "stage": stage,
        "fraction": fraction,
        "file": file,
        "loadedBytes": loaded,
        "totalBytes": total,
    })


def save_wav(path: Path, audio: np.ndarray) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(np.asarray(audio, np.float32), -1, 1)
    pcm = (clipped * 32_767.0).astype(np.int16).T
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(int(clipped.shape[0]))
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(pcm.tobytes())
    return clipped.shape[-1] / SAMPLE_RATE


def run_job(job: Job) -> None:
    request = job.request
    request_id = str(request.get("requestId", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
        raise ValueError("Invalid audio request id")
    model = str(request.get("model", "small-music"))
    if model not in MODEL_MAP:
        raise ValueError(f"Unsupported Stable Audio model: {model}")
    prompt = str(request.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("The audio description cannot be empty")
    seconds = min(MAX_SECONDS, max(MIN_SECONDS, float(request.get("durationSeconds", 8))))
    steps = min(16, max(1, int(request.get("steps", DEFAULT_STEPS))))
    guidance = min(10.0, max(0.0, float(request.get("guidanceScale", 3.0))))
    seed = int(request.get("seed", 0))
    if seed == 0:
        seed = abs(hash((request_id, prompt))) % (2**31 - 1)
    output = Path(str(request.get("outputPath", ""))).resolve()
    configured_root = os.environ.get("SA3_WORK_ROOT") or os.environ.get("SA3_CACHE_ROOT")
    if not configured_root:
        raise ValueError("Stable Audio cache root is not configured")
    work_root = Path(configured_root).resolve()
    output_root = (work_root / "generated").resolve()
    if output_root not in output.parents:
        raise ValueError("The output path must stay inside the configured Stable Audio cache")

    progress(job, "preparing-model", 0.0)
    ensure_model(
        model,
        verbose=False,
        on_progress=lambda file, loaded, total: progress(
            job,
            "downloading-model",
            loaded / max(total, 1),
            file,
            loaded,
            total,
        ),
    )
    progress(job, "preparing-model", 1.0)

    def report(stage: str, fraction: float) -> None:
        progress(job, stage, fraction)

    audio, timings = run_generation(
        MODEL_MAP[model],
        "same-s",
        "fp32",
        prompt,
        "",
        seconds,
        steps,
        seed,
        guidance,
        0.0,
        1.0,
        cfg_batched=True,
        on_progress=report,
    )
    if job.cancelled.is_set():
        raise Cancelled()
    duration = save_wav(output, audio)
    emit({
        "type": "completed",
        "requestId": request_id,
        "outputPath": str(output),
        "durationSeconds": duration,
        "sampleRate": SAMPLE_RATE,
        "model": model,
        "timings": timings,
    })


def handle_command(command: dict[str, object]) -> bool:
    global active_job
    command_type = command.get("type")
    if command_type == "shutdown":
        if active_job:
            active_job.cancelled.set()
        return False
    if command_type == "cancel":
        request_id = command.get("requestId")
        if active_job and active_job.request.get("requestId") == request_id:
            active_job.cancelled.set()
        return True
    if command_type != "generate":
        emit({"type": "error", "requestId": command.get("requestId"), "message": "Unknown service command"})
        return True
    if active_job is not None:
        emit({"type": "error", "requestId": command.get("requestId"), "message": "Another audio generation is already running"})
        return True
    job = Job(command)
    active_job = job

    def worker() -> None:
        global active_job
        try:
            run_job(job)
        except Cancelled:
            emit({"type": "cancelled", "requestId": command.get("requestId")})
        except Exception as error:
            emit({
                "type": "error",
                "requestId": command.get("requestId"),
                "message": str(error),
                "trace": traceback.format_exc(limit=4),
            })
        finally:
            active_job = None

    threading.Thread(target=worker, name=f"stable-audio-{command.get('requestId')}", daemon=True).start()
    return True


def main() -> None:
    thread = threading.Thread(target=stdin_reader, name="stable-audio-input", daemon=True)
    thread.start()
    emit({"type": "ready", "threads": THREADS})
    while True:
        if not handle_command(commands.get()):
            break


if __name__ == "__main__":
    main()

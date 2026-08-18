"""Long-lived MOSS-TTS-Nano ONNX CPU service for Luna AI Cut.

The host owns the environment and model cache locations. This process only
speaks JSON Lines and never writes generated files beside the packaged app.
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
PYTHON_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(PYTHON_ROOT))

from onnx_tts_runtime import OnnxTtsRuntime  # noqa: E402

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
SAMPLE_RATE = 48_000
CHANNELS = 2
DEFAULT_MAX_NEW_FRAMES = 375
DEFAULT_VOICE_CLONE_MAX_TEXT_TOKENS = 75
DEFAULT_SEED = 42
MIN_SPEED = 0.5
MAX_SPEED = 2.0
MAX_TEXT_LENGTH = 8_000


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, request: dict[str, object]) -> None:
        self.request = request
        self.cancelled = threading.Event()


commands: queue.Queue[dict[str, object]] = queue.Queue()
output_lock = threading.Lock()
active_job: Job | None = None
runtime: OnnxTtsRuntime | None = None
runtime_lock = threading.Lock()


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


def progress(job: Job, stage: str, fraction: float | None = None) -> None:
    if job.cancelled.is_set():
        raise Cancelled()
    emit({
        "type": "progress",
        "requestId": job.request.get("requestId"),
        "stage": stage,
        "fraction": fraction,
    })


def cancel_check(job: Job) -> None:
    if job.cancelled.is_set():
        raise Cancelled()


def get_runtime(job: Job) -> OnnxTtsRuntime:
    global runtime
    with runtime_lock:
        if runtime is not None:
            return runtime
        progress(job, "preparing-model", 0.0)
        model_root = Path(os.environ.get("MOSS_MODEL_ROOT", "")).expanduser().resolve()
        if not model_root.is_dir():
            raise FileNotFoundError(f"MOSS model directory does not exist: {model_root}")
        runtime = OnnxTtsRuntime(
            model_dir=model_root,
            thread_count=max(1, int(os.environ.get("MOSS_THREADS", "4"))),
            max_new_frames=DEFAULT_MAX_NEW_FRAMES,
            do_sample=True,
            sample_mode="fixed",
            execution_provider="cpu",
            output_dir=Path(os.environ.get("MOSS_OUTPUT_ROOT", "generated")),
        )
        progress(job, "preparing-model", 1.0)
        return runtime


def apply_playback_speed(waveform: np.ndarray, speed: float) -> np.ndarray:
    normalized_speed = min(MAX_SPEED, max(MIN_SPEED, float(speed)))
    audio = np.asarray(waveform, dtype=np.float32)
    if abs(normalized_speed - 1.0) < 0.001 or audio.shape[0] <= 1:
        return audio
    output_length = max(1, int(np.floor((audio.shape[0] - 1) / normalized_speed)) + 1)
    source_positions = np.arange(output_length, dtype=np.float64) * normalized_speed
    base_indices = np.floor(source_positions).astype(np.int64)
    next_indices = np.minimum(audio.shape[0] - 1, base_indices + 1)
    fractions = (source_positions - base_indices).astype(np.float32)[:, None]
    return audio[base_indices] + (audio[next_indices] - audio[base_indices]) * fractions


def save_wav(output_path: Path, audio: np.ndarray) -> float:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    waveform = np.asarray(audio, dtype=np.float32)
    if waveform.ndim != 2 or waveform.shape[1] != CHANNELS:
        raise ValueError(f"MOSS returned unexpected waveform shape: {waveform.shape}")
    clipped = np.clip(waveform, -1.0, 1.0)
    pcm16 = np.round(clipped * 32_767.0).astype(np.int16)
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16.tobytes())
    return waveform.shape[0] / SAMPLE_RATE


def output_path_for(request: dict[str, object]) -> Path:
    configured_root = os.environ.get("MOSS_OUTPUT_ROOT")
    if not configured_root:
        raise ValueError("MOSS output root is not configured")
    output_root = Path(configured_root).expanduser().resolve()
    requested = Path(str(request.get("outputPath", ""))).expanduser().resolve()
    if output_root != requested and output_root not in requested.parents:
        raise ValueError("The output path must stay inside the configured MOSS cache")
    return requested


def run_job(job: Job) -> None:
    request = job.request
    request_id = str(request.get("requestId", ""))
    if not REQUEST_ID_RE.fullmatch(request_id):
        raise ValueError("Invalid MOSS request id")
    text = str(request.get("text", "")).strip()
    if not text:
        raise ValueError("The speech text cannot be empty")
    if len(text) > MAX_TEXT_LENGTH:
        raise ValueError(f"The speech text is too long (maximum {MAX_TEXT_LENGTH} characters)")
    voice = str(request.get("voice", "Junhao")).strip() or "Junhao"
    speed = min(MAX_SPEED, max(MIN_SPEED, float(request.get("speed", 1.0))))
    output_path = output_path_for(request)
    reference_audio_path = request.get("referenceAudioPath")
    reference_path = str(reference_audio_path).strip() if reference_audio_path else None

    moss_runtime = get_runtime(job)
    available_voices = {str(item.get("voice")) for item in moss_runtime.list_builtin_voices()}
    if not reference_path and voice not in available_voices:
        raise ValueError(f"Unsupported MOSS voice: {voice}")
    if reference_path and not Path(reference_path).expanduser().is_file():
        raise FileNotFoundError(f"Reference audio does not exist: {reference_path}")

    progress(job, "generating", 0.0)
    max_frames = int(moss_runtime.manifest["generation_defaults"].get("max_new_frames", DEFAULT_MAX_NEW_FRAMES))

    def on_frame(chunk_index: int, chunk_count: int, step_index: int, generated_count: int) -> None:
        fraction = min(0.95, max(0.0, (chunk_index + generated_count / max(1, max_frames)) / max(1, chunk_count)))
        progress(job, "generating", fraction)

    result = moss_runtime.synthesize(
        text=text,
        voice=voice,
        prompt_audio_path=reference_path,
        output_audio_path=output_path,
        sample_mode="fixed",
        do_sample=True,
        streaming=True,
        max_new_frames=DEFAULT_MAX_NEW_FRAMES,
        voice_clone_max_text_tokens=DEFAULT_VOICE_CLONE_MAX_TEXT_TOKENS,
        enable_wetext=False,
        enable_normalize_tts_text=True,
        seed=DEFAULT_SEED,
        on_frame=on_frame,
        cancel_check=lambda: cancel_check(job),
    )
    cancel_check(job)
    waveform = apply_playback_speed(np.asarray(result["waveform"], dtype=np.float32), speed)
    progress(job, "saving", 0.97)
    duration = save_wav(output_path, waveform)
    emit({
        "type": "completed",
        "requestId": request_id,
        "outputPath": str(output_path),
        "durationSeconds": duration,
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
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
        emit({"type": "error", "requestId": command.get("requestId"), "message": "Another MOSS generation is already running"})
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

    threading.Thread(target=worker, name=f"moss-tts-{command.get('requestId')}", daemon=True).start()
    return True


def main() -> None:
    thread = threading.Thread(target=stdin_reader, name="moss-tts-input", daemon=True)
    thread.start()
    emit({"type": "ready", "sampleRate": SAMPLE_RATE, "channels": CHANNELS})
    while True:
        if not handle_command(commands.get()):
            break


if __name__ == "__main__":
    main()

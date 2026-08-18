# Stable Audio 3 TFLite CPU

This directory contains the standalone CPU implementation used by Luna AI Cut.
It runs Stable Audio 3 through LiteRT/TFLite and the XNNPACK CPU delegate. It
does not require PyTorch, Transformers, WebGPU, CUDA, MLX, or Apple Silicon.

## Luna AI Cut

The application exposes two models:

| Model | Use |
| --- | --- |
| small-music | Background music |
| small-sfx | Sound effects |

The service is a long-lived JSONL process started by Electron. It supports
asynchronous generation, progress reporting, cancellation, model unloading,
resumable downloads, and SHA256 verification.

The model weights are never bundled with the installer. On first use they are
downloaded from the fixed ModelScope revision recorded in
scripts/weights.py:

    https://www.modelscope.cn/models/stabilityai/stable-audio-3-optimized
    revision: 18feee20effaa4c3a32104d952318f64f2d5f290

All persistent model, environment, download, temporary, output, LoRA and
runtime cache data is placed below the user's configured base directory:

    <baseDir>/cache/
    ├── models/                       # other application model files
    ├── model-work/                   # temporary files used by local model workers
    ├── resource-packs/               # downloaded fonts/LUT packs
    └── stable-audio-3/
        ├── models/                   # Stable Audio weights
        ├── downloads/                # resumable files and pip/uv caches
        ├── runtime/
        │   ├── venv/                 # Python virtual environment
        │   ├── home/                 # HOME/USERPROFILE for third-party packages
        │   ├── appdata/              # Windows application data cache
        │   ├── localappdata/         # Windows local application data cache
        │   ├── cache/                # Python/XDG cache
        │   ├── pycache/              # Python bytecode
        │   └── ...
        ├── generated/                # temporary generated WAV files
        ├── loras/
        └── logs/

The Python process receives explicit cache and home environment variables,
including HOME, USERPROFILE, APPDATA, LOCALAPPDATA, TMPDIR, TEMP, TMP,
PIP_CACHE_DIR, XDG_CACHE_HOME, PYTHONPYCACHEPREFIX, HF_HOME,
GRADIO_TEMP_DIR, and UV_CACHE_DIR.
Neither the packaged application directory nor the operating system's default
cache directory is used for Stable Audio runtime data.

## Runtime dependencies

The application installs only the following small set of Python dependencies
into the base-directory virtual environment:

    ai_edge_litert
    numpy
    sentencepiece

Model weights remain external, so the application package itself does not
include the multi-gigabyte TFLite files.

## Standalone verification

The copied CLI can be used independently of Electron. Run install.sh once,
then choose either model:

    ./install.sh
    ./sa3 --prompt "lofi house loop, mellow piano" \
      --dit sm-music --decoder same-s --seconds 20 --out music.wav

    ./sa3 --prompt "footsteps on gravel, then a door closing" \
      --dit sm-sfx --decoder same-s --seconds 8 --out sfx.wav

The standalone CLI supports text-to-audio, audio-to-audio and inpainting. Its
default storage is local to the standalone checkout. To put all standalone
files under a chosen root, set SA3_CACHE_ROOT; the application sets this
automatically to <baseDir>/cache/stable-audio-3.

Windows uses install.bat and sa3.bat. The TFLite backend is CPU-only and
supports macOS, Linux and Windows x64.

## Model files and verification

scripts/weights.py is the single model manifest. It records every file's
expected size and SHA256. Downloads are resumable under downloads/, verified
before being atomically moved into models/, and only the two small DiT
bundles plus the shared T5Gemma and SAME-S files are accepted.

The complete manifest and license information are in MODEL-LICENSE.md. The
source code and weights are subject to their respective licenses; the project
does not redistribute model weights.

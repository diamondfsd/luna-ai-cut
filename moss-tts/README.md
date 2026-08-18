# MOSS-TTS-Nano CPU Runtime

This directory contains the small Python ONNX service used by Luna AI Cut.
It is intentionally separate from the Stable Audio source, but both services
use the same Python runtime bundled by the application build. End users do not
need to install Python or create a virtual environment. The application stores
model files, generated audio, Python cache, pip cache and temporary files below
the user's configured base directory:

```text
<baseDir>/cache/moss-tts/
```

The bundled runtime contains `numpy`, `onnxruntime`, `sentencepiece`, and the
shared Stable Audio LiteRT dependency set. It uses the pinned MOSS-TTS-Nano
ONNX source and the two pinned ModelScope revisions documented in
[MODEL-LICENSE.md](./MODEL-LICENSE.md). The runtime preparation step verifies
the interpreter archive and every dependency before packaging.

The packaged application starts `python/scripts/luna_service.py` as a long-
lived JSONL process. This keeps model initialization cached between requests,
serializes the memory-heavy CPU generation path, and supports progress and
cancellation without placing model data next to the installed application.

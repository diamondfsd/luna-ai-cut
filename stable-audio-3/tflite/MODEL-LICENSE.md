# Stable Audio 3 model notices

The TFLite model files are derived from Stability AI's Stable Audio 3
checkpoints. They are downloaded at runtime from the fixed ModelScope revision
listed in `scripts/weights.py` and are not included in the application package.

- Model: `stabilityai/stable-audio-3-optimized`
- Runtime: Stable Audio 3 TFLite / LiteRT CPU
- Revision: `cbf2601200b531a8304eb21a360a1a5ba371a10c`
- License: Stability AI Community License
- License terms: https://stability.ai/license
- Official source: https://github.com/Stability-AI/stable-audio-3
- Domestic source: https://www.modelscope.cn/models/stabilityai/stable-audio-3-optimized

The exact file sizes and SHA256 values used by the application are recorded in
`scripts/weights.py`. The downloader rejects a file when either value differs.

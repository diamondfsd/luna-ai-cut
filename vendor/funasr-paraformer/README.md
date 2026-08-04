# Luna Paraformer Worker

This worker adapts the native FunASR Paraformer GGUF runtime to Luna's NDJSON
subtitle worker protocol. It keeps FSMN-VAD segmentation and replaces the former
Whisper worker without adding Python to the packaged application. Continuous
speech is split with Paraformer's CIF token alignment, capped at approximately
four seconds or 16 visible characters per subtitle cue.

## Runtime Sources

- FunASR source commit: `06c59d2b46aa89ed1129bb24e74320db0c4fd646`
- Adapted upstream file: `runtime/llama.cpp/paraformer/funasr-paraformer/funasr-paraformer.cpp`
- Upstream file SHA256: `ac439f57bb96f6fddf59c751ca210b2f798e466f6ee5597114541a6e68996e27`
- Vendored FSMN-VAD header SHA256: `1fffde93c9df29dc63942dd8112a731441e2b73a21322b5a2d4a59dbc9d1d040`
- llama.cpp commit: `8086439a4cea94c71a5dfb8fe4ad1546aebd640f`
- Runtime licenses: MIT; see `LICENSE-FunASR` and `LICENSE-llama.cpp`.

## Model Assets

Runtime model downloads are restricted to fixed ModelScope revisions. The file
sizes, SHA256 values, versions, sources, and Apache-2.0 license records live in
`src/shared/subtitleModels.ts`. No alternate model download source is configured.

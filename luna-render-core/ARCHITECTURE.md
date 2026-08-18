# luna-render-core

`luna-render-core` contains the native worker binaries used by Luna AI Cut for
ONNX inference and speech processing. Visual composition, preview rendering,
LUT application, masking, and media export run in the renderer through the
WebGPU pipeline.

## Native workers

- `sam-segmentation-worker` performs point-guided SAM segmentation.
- `semantic-segmentation-worker` performs semantic segmentation and mask refinement.
- `specialized-segmentation-worker` runs subject, face, body, and embedding models.
- `luna-inpaint-worker` performs image removal/inpainting.
- `luna-punctuation-worker` restores punctuation for subtitle segments.
- `luna-asr-worker` is built from the vendored FunASR implementation and performs speech recognition.

The workers communicate with Electron through bounded stdin/stdout protocols.
They are intentionally separate processes so model memory, cancellation, and
native failures do not affect the Electron renderer.

## Rendering boundary

The Rust package does not contain a compositor, GPU device initialization,
native texture API, platform video surface bridge, or export pipeline. New
visual effects and export features belong in `src/lib/webgpu` and the related
React composition/export modules. Native code may remain for model inference
or media analysis only when it is not part of visual composition.

## Build outputs

`scripts/build-native.mjs` builds the worker binaries and copies the ONNX
Runtime libraries required by those workers. It does not build or package a
Node native addon.

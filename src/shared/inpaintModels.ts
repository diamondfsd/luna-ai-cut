const MODEL_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'

export const INPAINT_MODELS = [
  {
    id: 'big-lama-fp32',
    fileName: 'lama_fp32.onnx',
    sizeBytes: 208_044_816,
    url: `${MODEL_RELEASE_BASE}/big-lama-fp32.onnx`,
    upstreamUrl: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx',
    sha256: '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
    version: 'carve-c3c0c9e',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Carve/LaMa-ONNX',
    licenseUrl: 'https://huggingface.co/Carve/LaMa-ONNX/blob/c3c0c9e468934d62e79c329e35d82dd09ff8c444/README.md',
  },
] as const

export const DEFAULT_INPAINT_MODEL = INPAINT_MODELS[0]

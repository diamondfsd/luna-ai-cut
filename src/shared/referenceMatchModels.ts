const MODEL_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'

/** Neural-Preset 的固定 ONNX 转换产物；客户端最终通过 Rust + ONNX Runtime 推理。 */
export const REFERENCE_MATCH_MODELS = [
  {
    id: 'neural-preset-v1-256',
    name: 'Neural-Preset v1 256',
    description: 'AI 参考图追色',
    fileName: 'model.onnx',
    inputSize: 256,
    sizeBytes: 18_837_458,
    url: `${MODEL_RELEASE_BASE}/neural-preset-v1-256.onnx`,
    upstreamUrl: 'https://github.com/DY112/Neural-Preset',
    sha256: 'a940a6b084b8d36f6f22796503fc8fe0354d4ecaec55ba8a1f11dbcce9c1c269',
    version: 'v1-256',
    license: 'MIT（代码）；预训练权重按上游说明仅限研究用途',
    source: 'https://github.com/DY112/Neural-Preset',
    licenseUrl: 'https://github.com/DY112/Neural-Preset/blob/main/LICENSE',
  },
] as const

export type ReferenceMatchModelId = typeof REFERENCE_MATCH_MODELS[number]['id']

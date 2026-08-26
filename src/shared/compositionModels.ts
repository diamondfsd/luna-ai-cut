const MODEL_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'

/** ReLIC++ CPC is a scalar composition regressor, not a segmentation model. */
export const COMPOSITION_MODELS = [
  {
    id: 'relic2-cpc',
    backend: 'relic2-cpc',
    name: 'ReLIC++ CPC',
    description: '照片构图质量评分',
    inputSize: 224,
    outputRange: [0, 3],
    fileName: 'model.onnx',
    sizeBytes: 18_513_096,
    url: `${MODEL_RELEASE_BASE}/relic2-cpc.onnx`,
    upstreamUrl: 'https://github.com/fei-aiart/ReLIC/blob/master/code/CPC/pretrain_model/relic2_model.pth',
    sha256: '5f0cc1ab06f1795415cd080170e43d7e7cb312e700b10a8b6b667af2d83b1f7b',
    version: 'relic2-cpc-onnx-v1',
    license: 'MIT',
    source: 'https://github.com/fei-aiart/ReLIC',
    licenseUrl: 'https://github.com/fei-aiart/ReLIC/blob/master/LICENSE',
    trainingData: 'Comparative Photo Composition (CPC) database',
    trainingDataUrl: 'https://www3.cs.stonybrook.edu/~cvl/projects/wei2018goods/VPN_CVPR2018s.html',
    upstreamWeightsSha256: '974d70fc4f8646c5a05be2258a948333b7b4c9f23931be0512ccba6b58b74aa4',
  },
] as const

export type CompositionModelId = typeof COMPOSITION_MODELS[number]['id']

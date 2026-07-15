export const SEGMENTATION_MODELS = [
  {
    id: 'segformer-b0-ade20k',
    name: 'SegFormer B0',
    description: '速度优先',
    sizeBytes: 15_335_446,
    url: 'https://modelscope.cn/models/Xenova/segformer-b0-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2',
  },
  {
    id: 'segformer-b1-ade20k',
    name: 'SegFormer B1',
    description: '均衡',
    sizeBytes: 55_187_948,
    url: 'https://modelscope.cn/models/Xenova/segformer-b1-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '2cd97ac49e7420088cfd75fe028437af021342611ffffa3a33465720692900c6',
  },
  {
    id: 'segformer-b2-ade20k',
    name: 'SegFormer B2',
    description: '细节优先',
    sizeBytes: 110_445_327,
    url: 'https://modelscope.cn/models/Xenova/segformer-b2-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0',
  },
  {
    id: 'segformer-b3-ade20k',
    name: 'SegFormer B3',
    description: '最高精度',
    sizeBytes: 190_376_626,
    url: 'https://modelscope.cn/models/Xenova/segformer-b3-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: 'dfa5e8f62b7c1683de1edcea22c8c7a0d7f8e6768b5ae93f7c62e683f0b98708',
  },
] as const

export const SAM_MODEL = {
  id: 'sam-vit-b',
  name: 'SAM ViT-B',
  description: '点选对象',
  sizeBytes: 105_992_279,
  version: 'main',
  license: 'Apache-2.0',
  source: 'https://modelscope.cn/models/Xenova/sam-vit-base',
  licenseUrl: 'https://huggingface.co/Xenova/sam-vit-base/blob/main/README.md',
  files: {
    visionEncoder: {
      fileName: 'vision_encoder_quantized.onnx',
      sizeBytes: 101_088_469,
      url: 'https://modelscope.cn/models/Xenova/sam-vit-base/resolve/master/onnx/vision_encoder_quantized.onnx',
      sha256: 'd9d7bca3b256ab71b3b7cdc35839983bc8ebaf68ea9022f15805ac43955cd247',
    },
    promptDecoder: {
      fileName: 'prompt_encoder_mask_decoder_quantized.onnx',
      sizeBytes: 4_903_810,
      url: 'https://modelscope.cn/models/Xenova/sam-vit-base/resolve/master/onnx/prompt_encoder_mask_decoder_quantized.onnx',
      sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
    },
  },
} as const

export type SemanticSegmentationModelId = typeof SEGMENTATION_MODELS[number]['id']
export type SegmentationModelId = SemanticSegmentationModelId | typeof SAM_MODEL.id

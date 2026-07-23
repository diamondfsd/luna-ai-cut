import { ADE20K_REMAINING_SEGMENTATION_TARGETS } from './ade20kSegmentationTargets'

export const SEGMENTATION_MODELS = [
  {
    id: 'segformer-b0-ade20k',
    name: 'SegFormer B0',
    description: '速度优先',
    inputSize: 512,
    sizeBytes: 15_335_446,
    url: 'https://modelscope.cn/models/Xenova/segformer-b0-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2',
    version: 'master',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b0-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  {
    id: 'segformer-b1-ade20k',
    name: 'SegFormer B1',
    description: '均衡',
    inputSize: 512,
    sizeBytes: 55_187_948,
    url: 'https://modelscope.cn/models/Xenova/segformer-b1-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '2cd97ac49e7420088cfd75fe028437af021342611ffffa3a33465720692900c6',
    version: 'master',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b1-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  {
    id: 'segformer-b2-ade20k',
    name: 'SegFormer B2',
    description: '细节优先',
    inputSize: 512,
    sizeBytes: 110_445_327,
    url: 'https://modelscope.cn/models/Xenova/segformer-b2-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0',
    version: 'master',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b2-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  {
    id: 'segformer-b3-ade20k',
    name: 'SegFormer B3',
    description: '高精度',
    inputSize: 512,
    sizeBytes: 190_376_626,
    url: 'https://modelscope.cn/models/Xenova/segformer-b3-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: 'dfa5e8f62b7c1683de1edcea22c8c7a0d7f8e6768b5ae93f7c62e683f0b98708',
    version: 'master',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b3-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  {
    id: 'segformer-b5-ade20k',
    name: 'SegFormer B5',
    description: '640px 最高精度',
    inputSize: 640,
    sizeBytes: 89_540_816,
    url: 'https://modelscope.cn/models/Xenova/segformer-b5-finetuned-ade-640-640/resolve/master/onnx/model_quantized.onnx',
    sha256: '7b20b28f213e6d1128cb850c3fa273a061f0aa87a49224316791fdab49515a51',
    version: '87c0b061',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b5-finetuned-ade-640-640',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  {
    id: 'maskformer-r101-ade20k-full',
    name: 'MaskFormer R101',
    description: '天空 / 海洋增强',
    inputSize: 512,
    sizeBytes: 61_959_497,
    url: 'https://modelscope.cn/models/onnx-community/maskformer-resnet101-ade20k-full/resolve/master/onnx/model_quantized.onnx',
    sha256: 'a3ceb38f2e3552c2d92715d34da2e15c6a11e7149d967783ad4a8dda45494ed9',
    version: '2a990c891d551b16993ca99c70386888d36f30f4',
    license: 'CC BY-NC 4.0',
    source: 'https://modelscope.cn/models/onnx-community/maskformer-resnet101-ade20k-full',
    licenseUrl: 'https://github.com/facebookresearch/MaskFormer/blob/main/LICENSE',
  },
] as const

export const SPECIALIZED_SEGMENTATION_MODELS = [
  {
    id: 'yolo26s-seg',
    backend: 'yolo26-seg',
    name: 'YOLO26s-seg',
    description: '人物识别',
    inputSize: 640,
    sizeBytes: 41_912_273,
    url: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/runtime-resources-v1.1.0/yolo26s-seg.onnx',
    mirrors: ['https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s-seg.onnx'],
    sha256: 'd205b2c489e7cf0cdb183bb23e56dc8a32a79602e8c5b1f5ecb01af0dc6822c3',
    version: 'ultralytics-assets-v8.4.0',
    license: 'AGPL-3.0',
    source: 'https://github.com/ultralytics/assets/releases/tag/v8.4.0',
    licenseUrl: 'https://github.com/ultralytics/ultralytics/blob/main/LICENSE',
  },
  {
    id: 'rmbg-1.4',
    backend: 'rmbg-1.4',
    name: 'RMBG 1.4',
    description: '主体对比测试',
    inputSize: 1024,
    sizeBytes: 176_153_355,
    url: 'https://modelscope.cn/models/briaai/RMBG-1.4/resolve/master/onnx/model.onnx',
    mirrors: ['https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx'],
    sha256: '8cafcf770b06757c4eaced21b1a88e57fd2b66de01b8045f35f01535ba742e0f',
    version: 'main-fp32',
    license: 'Apache-2.0',
    source: 'https://modelscope.cn/models/briaai/RMBG-1.4',
    licenseUrl: 'https://huggingface.co/briaai/RMBG-1.4/blob/main/README.md',
  },
  {
    id: 'birefnet-general-lite',
    backend: 'birefnet-general-lite',
    name: 'BiRefNet General Lite',
    description: '主体识别',
    inputSize: 1024,
    sizeBytes: 224_005_088,
    url: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/runtime-resources-v1.1.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    mirrors: ['https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'],
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    version: 'v1-epoch-232',
    license: 'MIT',
    source: 'https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1',
    licenseUrl: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE',
  },
] as const

const SAM_DECODER = {
  fileName: 'prompt_encoder_mask_decoder_quantized.onnx',
  sizeBytes: 4_903_810,
  sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
} as const

export const SAM_MODELS = [
  {
    id: 'slimsam-77-uniform',
    name: 'SlimSAM 77',
    description: '体积最小',
    inputSize: 1024,
    sizeBytes: 13_785_975,
    version: 'main',
    license: 'Apache-2.0',
    source: 'https://modelscope.cn/models/Xenova/slimsam-77-uniform',
    licenseUrl: 'https://modelscope.cn/models/Xenova/slimsam-77-uniform',
    files: {
      visionEncoder: {
        fileName: 'vision_encoder_quantized.onnx',
        sizeBytes: 8_882_165,
        url: 'https://modelscope.cn/models/Xenova/slimsam-77-uniform/resolve/master/onnx/vision_encoder_quantized.onnx',
        sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
      },
      promptDecoder: {
        ...SAM_DECODER,
        url: 'https://modelscope.cn/models/Xenova/slimsam-77-uniform/resolve/master/onnx/prompt_encoder_mask_decoder_quantized.onnx',
      },
    },
  },
  {
    id: 'slimsam-50-uniform',
    name: 'SlimSAM 50',
    description: '速度优先',
    inputSize: 1024,
    sizeBytes: 34_972_695,
    version: 'main',
    license: 'Apache-2.0',
    source: 'https://modelscope.cn/models/Xenova/slimsam-50-uniform',
    licenseUrl: 'https://modelscope.cn/models/Xenova/slimsam-50-uniform',
    files: {
      visionEncoder: {
        fileName: 'vision_encoder_quantized.onnx',
        sizeBytes: 30_068_885,
        url: 'https://modelscope.cn/models/Xenova/slimsam-50-uniform/resolve/master/onnx/vision_encoder_quantized.onnx',
        sha256: '84934ceb504b07a757c63f56440699c9c593933b41bea3e11c261eb27a35baab',
      },
      promptDecoder: {
        ...SAM_DECODER,
        url: 'https://modelscope.cn/models/Xenova/slimsam-50-uniform/resolve/master/onnx/prompt_encoder_mask_decoder_quantized.onnx',
      },
    },
  },
  {
    id: 'sam-vit-b',
    name: 'SAM ViT-B',
    description: '细节优先',
    inputSize: 1024,
    sizeBytes: 105_992_279,
    version: 'main',
    license: 'Apache-2.0',
    source: 'https://modelscope.cn/models/Xenova/sam-vit-base',
    licenseUrl: 'https://modelscope.cn/models/Xenova/sam-vit-base',
    files: {
      visionEncoder: {
        fileName: 'vision_encoder_quantized.onnx',
        sizeBytes: 101_088_469,
        url: 'https://modelscope.cn/models/Xenova/sam-vit-base/resolve/master/onnx/vision_encoder_quantized.onnx',
        sha256: 'd9d7bca3b256ab71b3b7cdc35839983bc8ebaf68ea9022f15805ac43955cd247',
      },
      promptDecoder: {
        ...SAM_DECODER,
        url: 'https://modelscope.cn/models/Xenova/sam-vit-base/resolve/master/onnx/prompt_encoder_mask_decoder_quantized.onnx',
      },
    },
  },
] as const

/** 兼容旧调用；新代码应使用 SAM_MODELS。 */
export const SAM_MODEL = SAM_MODELS[2]

export type SemanticSegmentationModelId = typeof SEGMENTATION_MODELS[number]['id']
export type SpecializedSegmentationModelId = typeof SPECIALIZED_SEGMENTATION_MODELS[number]['id']
export type SamSegmentationModelId = typeof SAM_MODELS[number]['id']
export type SingleFileSegmentationModelId = SemanticSegmentationModelId | SpecializedSegmentationModelId
export type SegmentationModelId = SingleFileSegmentationModelId | SamSegmentationModelId
export function modelForSegmentationRequest(
  targetId: AutomaticSegmentationTargetId | undefined,
  requestedModelId: SegmentationModelId | undefined,
): SegmentationModelId {
  const target = targetId ? automaticSegmentationTarget(targetId) : undefined
  return target?.modelId ?? requestedModelId ?? 'segformer-b0-ade20k'
}

export const DEFAULT_POINT_SEGMENTATION_MODEL_ID: SamSegmentationModelId = 'slimsam-77-uniform'

export function isSamSegmentationModel(id: string): id is SamSegmentationModelId {
  return SAM_MODELS.some((model) => model.id === id)
}

export function isSpecializedSegmentationModel(id: string): id is SpecializedSegmentationModelId {
  return SPECIALIZED_SEGMENTATION_MODELS.some((model) => model.id === id)
}

export const AUTOMATIC_SEGMENTATION_TARGETS = [
  { id: 'sky', classId: 2, label: '天空', modelId: 'segformer-b5-ade20k' },
  { id: 'water', classId: 21, label: '水面', modelId: 'segformer-b5-ade20k' },
  { id: 'tree', classId: 4, label: '树木', modelId: 'segformer-b5-ade20k' },
  { id: 'building', classId: 1, label: '建筑', modelId: 'segformer-b5-ade20k' },
  { id: 'vehicle', classId: 20, label: '车辆', modelId: 'segformer-b5-ade20k' },
  { id: 'mountain', classId: 16, label: '山体', modelId: 'segformer-b5-ade20k' },
  { id: 'subject', classId: -1, label: '主体', modelId: 'rmbg-1.4' },
  ...ADE20K_REMAINING_SEGMENTATION_TARGETS,
] satisfies ReadonlyArray<{
  id: string
  classId: number
  label: string
  modelId: SingleFileSegmentationModelId
}>

export type AutomaticSegmentationTarget = typeof AUTOMATIC_SEGMENTATION_TARGETS[number]
export type AutomaticSegmentationTargetId = AutomaticSegmentationTarget['id']

export function automaticSegmentationTarget(id: string) {
  return AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === id)
}

export const COMMON_SEGMENTATION_TARGETS = [
  { classId: 2, label: '天空' },
  { classId: 21, label: '海洋 / 水面' },
  { classId: 4, label: '树木' },
  { classId: 9, label: '草地' },
  { classId: 17, label: '植物' },
  { classId: 16, label: '山体' },
  { classId: 20, label: '车辆' },
  { classId: 1, label: '建筑' },
] as const

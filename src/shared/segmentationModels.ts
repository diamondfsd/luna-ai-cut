import { ADE20K_REMAINING_SEGMENTATION_TARGETS } from './ade20kSegmentationTargets'

const MODEL_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'

export const SEGMENTATION_MODELS = [
  {
    id: 'segformer-b5-ade20k',
    name: 'SegFormer B5',
    description: '640px 最高精度',
    inputSize: 640,
    sizeBytes: 89_540_816,
    url: 'https://modelscope.cn/models/Xenova/segformer-b5-finetuned-ade-640-640/resolve/master/onnx/model_quantized.onnx',
    mirrors: [`${MODEL_RELEASE_BASE}/segformer-b5-ade20k.onnx`],
    sha256: '7b20b28f213e6d1128cb850c3fa273a061f0aa87a49224316791fdab49515a51',
    version: '87c0b061',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b5-finetuned-ade-640-640',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
] as const

export const SPECIALIZED_SEGMENTATION_MODELS = [
  {
    id: 'face-parsing-resnet18',
    backend: 'face-parsing',
    name: '人脸皮肤识别',
    description: '面部皮肤与五官保护区',
    inputSize: 512,
    sizeBytes: 53_205_364,
    url: `${MODEL_RELEASE_BASE}/face-parsing-resnet18.onnx`,
    upstreamUrl: 'https://github.com/yakhyo/face-parsing/releases/download/weights/resnet18.onnx',
    sha256: '0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f',
    version: 'weights-2025-12-14',
    license: 'MIT code; CelebAMask-HQ non-commercial research weights',
    source: 'https://github.com/yakhyo/face-parsing/releases/tag/weights',
    licenseUrl: 'https://github.com/yakhyo/face-parsing',
  },
  {
    id: 'schp-atr-resnet101-512',
    backend: 'human-parsing',
    name: '人体皮肤识别',
    description: '高精度手臂与腿部皮肤区域',
    inputSize: 512,
    sizeBytes: 267_817_246,
    url: `${MODEL_RELEASE_BASE}/schp-atr-resnet101-512.onnx`,
    upstreamUrl: 'https://drive.google.com/file/d/1ruJg4lqR_jgQPj-9K0PP-L2vJERYOxLP/view',
    sha256: '96090b160ad2f3a04e27c075dbb94f4d4d29b359bbe1d91b543bc1010e8aa9c4',
    version: 'eb84c432-e9d7c91c-opset18',
    license: 'MIT code; ATR training data is for research use',
    source: 'https://github.com/GoGoDuck912/Self-Correction-Human-Parsing/tree/eb84c432cc697f494d99662a05f2335eb2f26095',
    licenseUrl: 'https://github.com/GoGoDuck912/Self-Correction-Human-Parsing/blob/eb84c432cc697f494d99662a05f2335eb2f26095/LICENSE',
    trainingData: 'ATR human parsing dataset, 17,700+ single-person images and 18 labels',
    trainingDataUrl: 'https://github.com/GoGoDuck912/Self-Correction-Human-Parsing/tree/eb84c432cc697f494d99662a05f2335eb2f26095#atr',
    convertedFromSha256: 'e9d7c91ce3b4e7133df56b599fc817b533e3439c5e8d282a59126d2fda339a2a',
  },
  {
    id: 'yolo26s-seg',
    backend: 'yolo26-seg',
    name: 'YOLO26s-seg',
    description: '人物识别',
    inputSize: 640,
    sizeBytes: 41_912_273,
    url: `${MODEL_RELEASE_BASE}/yolo26s-seg.onnx`,
    upstreamUrl: 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s-seg.onnx',
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
    mirrors: [
      `${MODEL_RELEASE_BASE}/rmbg-1.4.onnx`,
    ],
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
    url: `${MODEL_RELEASE_BASE}/birefnet-general-lite.onnx`,
    upstreamUrl: 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    version: 'v1-epoch-232',
    license: 'MIT',
    source: 'https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1',
    licenseUrl: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE',
  },
] as const

export const AI_SELECTION_MODELS = [
  {
    id: 'dinov2-small',
    name: 'DINOv2 Small',
    description: 'AI 选片视觉特征',
    inputSize: 224,
    sizeBytes: 24_451_943,
    url: 'https://modelscope.cn/models/Xenova/dinov2-small/resolve/master/onnx/model_quantized.onnx',
    mirrors: [
      `${MODEL_RELEASE_BASE}/dinov2-small.onnx`,
    ],
    sha256: '3afdc8bc63b50558d6e5770f5b799bb82455c2311183a2de43803f343a29d917',
    version: 'master-quantized',
    license: 'Apache-2.0',
    source: 'https://modelscope.cn/models/Xenova/dinov2-small',
    licenseUrl: 'https://github.com/facebookresearch/dinov2/blob/main/LICENSE',
  },
  {
    id: 'ultraface-rfb-320',
    name: 'UltraFace RFB 320',
    description: 'AI 选片人脸检测',
    inputSize: 320,
    sizeBytes: 1_270_727,
    url: `${MODEL_RELEASE_BASE}/ultraface-rfb-320.onnx`,
    upstreamUrl: 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
    sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
    version: 'version-RFB-320',
    license: 'MIT',
    source: 'https://github.com/onnx/models/tree/main/validated/vision/body_analysis/ultraface',
    licenseUrl: 'https://github.com/onnx/models/blob/main/validated/vision/body_analysis/ultraface/README.md#license',
  },
  {
    id: 'open-closed-eye-0001',
    name: 'Open Closed Eye 0001',
    description: 'AI 选片闭眼检测',
    inputSize: 32,
    sizeBytes: 46_164,
    url: `${MODEL_RELEASE_BASE}/open-closed-eye-0001.onnx`,
    upstreamUrl: 'https://storage.openvinotoolkit.org/repositories/open_model_zoo/public/2022.1/open-closed-eye-0001/open_closed_eye.onnx',
    sha256: '4daa100034482525a26c9afb9297c16580a531189e66e3d2b2ac7d32becfd593',
    version: 'open-model-zoo-2022.1',
    license: 'Apache-2.0',
    source: 'https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/public/open-closed-eye-0001',
    licenseUrl: 'https://github.com/openvinotoolkit/open_model_zoo/blob/master/LICENSE',
  },
  {
    id: 'sface-2021dec-int8',
    name: 'SFace 2021 December INT8',
    description: 'AI 选片人脸身份特征',
    inputSize: 112,
    sizeBytes: 9_896_933,
    url: `${MODEL_RELEASE_BASE}/sface-2021dec-int8.onnx`,
    upstreamUrl: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec_int8.onnx',
    sha256: '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a',
    version: '2021dec-int8',
    license: 'Apache-2.0',
    source: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface',
    licenseUrl: 'https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE',
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
        mirrors: [`${MODEL_RELEASE_BASE}/slimsam-77-uniform-vision-encoder.onnx`],
        sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
      },
      promptDecoder: {
        ...SAM_DECODER,
        url: 'https://modelscope.cn/models/Xenova/slimsam-77-uniform/resolve/master/onnx/prompt_encoder_mask_decoder_quantized.onnx',
        mirrors: [`${MODEL_RELEASE_BASE}/sam-prompt-decoder-quantized.onnx`],
      },
    },
  },
] as const

export type SemanticSegmentationModelId = typeof SEGMENTATION_MODELS[number]['id']
export type SpecializedSegmentationModelId = typeof SPECIALIZED_SEGMENTATION_MODELS[number]['id']
export type AiSelectionModelId = typeof AI_SELECTION_MODELS[number]['id']
export type SamSegmentationModelId = typeof SAM_MODELS[number]['id']
export type SingleFileSegmentationModelId = SemanticSegmentationModelId | SpecializedSegmentationModelId
export type SegmentationModelId = SingleFileSegmentationModelId | SamSegmentationModelId
export type SegmentationModelPreparationId = SegmentationModelId | AiSelectionModelId
export function modelForSegmentationRequest(
  targetId: AutomaticSegmentationTargetId | undefined,
  requestedModelId: SegmentationModelId | undefined,
): SegmentationModelId {
  const target = targetId ? automaticSegmentationTarget(targetId) : undefined
  return target?.modelId ?? requestedModelId ?? 'segformer-b5-ade20k'
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

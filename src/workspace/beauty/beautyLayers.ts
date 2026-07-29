import { createDefaultPipeline, type ColorMaskLayer, type EditPipeline } from '../shared/editPipeline'

export const BEAUTY_FACE_LAYER_ID = 'beauty-face-skin'
export const BEAUTY_BODY_LAYER_ID = 'beauty-body-skin'

export interface BeautyParameters {
  faceWhitening: number
  skinWhitening: number
  smoothing: number
}

export const DEFAULT_BEAUTY_PARAMETERS: BeautyParameters = {
  faceWhitening: 18,
  skinWhitening: 10,
  smoothing: 28,
}

export function beautyLayers(pipeline: EditPipeline): { face: ColorMaskLayer | null; body: ColorMaskLayer | null } {
  return {
    face: pipeline.colorMasks.find((layer) => layer.id === BEAUTY_FACE_LAYER_ID) ?? null,
    body: pipeline.colorMasks.find((layer) => layer.id === BEAUTY_BODY_LAYER_ID) ?? null,
  }
}

export function beautyParameters(pipeline: EditPipeline): BeautyParameters {
  const layers = beautyLayers(pipeline)
  const skinWhitening = Math.round((layers.body?.color.brightness ?? 0) / 0.18)
  const combinedFaceWhitening = (layers.face?.color.brightness ?? 0) - skinWhitening * 0.18
  return {
    faceWhitening: Math.max(0, Math.min(100, Math.round(combinedFaceWhitening / 0.22))),
    skinWhitening: Math.max(0, Math.min(100, skinWhitening)),
    smoothing: Math.max(0, Math.min(100, Math.round(layers.face?.color.denoise ?? 0))),
  }
}

function faceColor(parameters: BeautyParameters): EditPipeline['color'] {
  const color = createDefaultPipeline().color
  const brightness = parameters.skinWhitening * 0.18 + parameters.faceWhitening * 0.22
  return {
    ...color,
    brightness,
    shadows: parameters.faceWhitening * 0.04,
    highlights: -parameters.faceWhitening * 0.03,
    denoise: parameters.smoothing,
  }
}

function bodyColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    brightness: parameters.skinWhitening * 0.18,
    highlights: -parameters.skinWhitening * 0.02,
  }
}

export function updateBeautyParameters(pipeline: EditPipeline, parameters: BeautyParameters): ColorMaskLayer[] {
  return pipeline.colorMasks.map((layer) => {
    if (layer.id === BEAUTY_FACE_LAYER_ID) return { ...layer, color: faceColor(parameters) }
    if (layer.id === BEAUTY_BODY_LAYER_ID) return { ...layer, color: bodyColor(parameters) }
    return layer
  })
}

export function createBeautyMaskLayer(
  kind: 'face' | 'body',
  saved: { path: string; width: number; height: number },
  parameters: BeautyParameters,
): ColorMaskLayer {
  const face = kind === 'face'
  return {
    id: face ? BEAUTY_FACE_LAYER_ID : BEAUTY_BODY_LAYER_ID,
    name: face ? '美颜 · 面部皮肤' : '美颜 · 身体皮肤',
    path: saved.path,
    width: saved.width,
    height: saved.height,
    opacity: 1,
    inverted: false,
    feather: 0,
    kind: 'semantic',
    modelId: face ? 'face-parsing-resnet18' : 'schp-atr-18-int8',
    enabled: true,
    blendMode: 'normal',
    color: face ? faceColor(parameters) : bodyColor(parameters),
  }
}

export function replaceBeautyLayers(pipeline: EditPipeline, face: ColorMaskLayer, body: ColorMaskLayer): ColorMaskLayer[] {
  return [...pipeline.colorMasks.filter((layer) => (
    layer.id !== BEAUTY_FACE_LAYER_ID && layer.id !== BEAUTY_BODY_LAYER_ID
  )), body, face]
}

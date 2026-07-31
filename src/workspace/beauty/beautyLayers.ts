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

const BODY_EXPOSURE_PER_STEP = 0.0015
const BODY_RENDER_EXPOSURE_PER_STEP = BODY_EXPOSURE_PER_STEP * 2
const FACE_EXPOSURE_PER_STEP = 0.003

function clampParameter(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function normalizedExposure(value: number): number {
  return Number(value.toFixed(4))
}

export function beautyLayers(pipeline: EditPipeline): { face: ColorMaskLayer | null; body: ColorMaskLayer | null } {
  return {
    face: pipeline.colorMasks.find((layer) => layer.id === BEAUTY_FACE_LAYER_ID) ?? null,
    body: pipeline.colorMasks.find((layer) => layer.id === BEAUTY_BODY_LAYER_ID) ?? null,
  }
}

export function beautyParameters(pipeline: EditPipeline): BeautyParameters {
  const layers = beautyLayers(pipeline)
  const bodyColor = layers.body?.color
  const faceColor = layers.face?.color
  const skinWhitening = clampParameter(bodyColor?.exposure
    ? Math.round(bodyColor.exposure / BODY_EXPOSURE_PER_STEP)
    : Math.round((bodyColor?.brightness ?? 0) / 0.18))
  const combinedFaceExposure = (faceColor?.exposure ?? 0) - skinWhitening * BODY_EXPOSURE_PER_STEP
  const combinedFaceBrightness = (faceColor?.brightness ?? 0) - skinWhitening * 0.18
  const faceWhitening = faceColor?.exposure
    ? Math.round(combinedFaceExposure / FACE_EXPOSURE_PER_STEP)
    : Math.round(combinedFaceBrightness / 0.22)
  return {
    faceWhitening: clampParameter(faceWhitening),
    skinWhitening,
    smoothing: clampParameter(Math.round(layers.face?.color.denoise ?? 0)),
  }
}

function faceColor(parameters: BeautyParameters): EditPipeline['color'] {
  const color = createDefaultPipeline().color
  return {
    ...color,
    exposure: normalizedExposure(
      parameters.skinWhitening * BODY_EXPOSURE_PER_STEP
        + parameters.faceWhitening * FACE_EXPOSURE_PER_STEP,
    ),
    highlights: -parameters.faceWhitening * 0.03,
    denoise: parameters.smoothing,
  }
}

function bodyColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    exposure: normalizedExposure(parameters.skinWhitening * BODY_EXPOSURE_PER_STEP),
    highlights: -parameters.skinWhitening * 0.02,
  }
}

function faceColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...faceColor(parameters),
    exposure: normalizedExposure(
      parameters.skinWhitening * BODY_RENDER_EXPOSURE_PER_STEP
        + parameters.faceWhitening * FACE_EXPOSURE_PER_STEP,
    ),
  }
}

function bodyColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...bodyColor(parameters),
    exposure: normalizedExposure(parameters.skinWhitening * BODY_RENDER_EXPOSURE_PER_STEP),
  }
}

export function beautyLayerColorForRendering(
  pipeline: EditPipeline,
  layer: ColorMaskLayer,
): EditPipeline['color'] {
  const parameters = beautyParameters(pipeline)
  if (layer.id === BEAUTY_FACE_LAYER_ID) return faceColorForRendering(parameters)
  if (layer.id === BEAUTY_BODY_LAYER_ID) return bodyColorForRendering(parameters)
  return layer.color
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

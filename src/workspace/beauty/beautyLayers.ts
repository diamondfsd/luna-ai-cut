import { createDefaultPipeline, type ColorMaskLayer, type EditPipeline } from '../shared/editPipeline'

export const BEAUTY_FACE_LAYER_ID = 'beauty-face-skin'
export const BEAUTY_BODY_LAYER_ID = 'beauty-body-skin'
export const BEAUTY_ACNE_LAYER_ID = 'beauty-acne'
export const BEAUTY_SPOT_LAYER_ID = 'beauty-spots'
export const BEAUTY_WRINKLE_LAYER_ID = 'beauty-wrinkles'

export type BeautyMaskKind = 'face' | 'body' | 'acne' | 'spot' | 'wrinkle'

export interface BeautyParameters {
  faceWhitening: number
  skinWhitening: number
  smoothing: number
  acneRemoval: number
  spotRemoval: number
  wrinkleReduction: number
}

export const DEFAULT_BEAUTY_PARAMETERS: BeautyParameters = {
  faceWhitening: 18,
  skinWhitening: 10,
  smoothing: 28,
  acneRemoval: 35,
  spotRemoval: 20,
  wrinkleReduction: 20,
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

export function beautyLayers(pipeline: EditPipeline): {
  face: ColorMaskLayer | null
  body: ColorMaskLayer | null
  acne: ColorMaskLayer | null
  spot: ColorMaskLayer | null
  wrinkle: ColorMaskLayer | null
} {
  return {
    face: pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_FACE_LAYER_ID) ?? null,
    body: pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_BODY_LAYER_ID) ?? null,
    acne: pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_ACNE_LAYER_ID) ?? null,
    spot: pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_SPOT_LAYER_ID) ?? null,
    wrinkle: pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_WRINKLE_LAYER_ID) ?? null,
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
    acneRemoval: layers.acne
      ? clampParameter(Math.round(layers.acne.color.denoise ?? 0))
      : DEFAULT_BEAUTY_PARAMETERS.acneRemoval,
    spotRemoval: layers.spot
      ? clampParameter(Math.round((layers.spot.color.exposure ?? 0) / 0.002))
      : DEFAULT_BEAUTY_PARAMETERS.spotRemoval,
    wrinkleReduction: layers.wrinkle
      ? clampParameter(Math.round((layers.wrinkle.color.denoise ?? 0) / 0.75))
      : DEFAULT_BEAUTY_PARAMETERS.wrinkleReduction,
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

function acneColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    exposure: normalizedExposure(parameters.acneRemoval * 0.00025),
    highlights: -parameters.acneRemoval * 0.02,
    denoise: parameters.acneRemoval,
  }
}

function spotColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    exposure: normalizedExposure(parameters.spotRemoval * 0.002),
    saturation: -parameters.spotRemoval * 0.08,
    denoise: parameters.spotRemoval * 0.35,
  }
}

function wrinkleColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    exposure: normalizedExposure(parameters.wrinkleReduction * 0.0002),
    clarity: -parameters.wrinkleReduction * 0.2,
    denoise: parameters.wrinkleReduction * 0.75,
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
  return pipeline.beautyMasks.map((layer) => {
    if (layer.id === BEAUTY_FACE_LAYER_ID) return { ...layer, color: faceColor(parameters) }
    if (layer.id === BEAUTY_BODY_LAYER_ID) return { ...layer, color: bodyColor(parameters) }
    if (layer.id === BEAUTY_ACNE_LAYER_ID) return { ...layer, color: acneColor(parameters) }
    if (layer.id === BEAUTY_SPOT_LAYER_ID) return { ...layer, color: spotColor(parameters) }
    if (layer.id === BEAUTY_WRINKLE_LAYER_ID) return { ...layer, color: wrinkleColor(parameters) }
    return layer
  })
}

export function createBeautyMaskLayer(
  kind: BeautyMaskKind,
  saved: { path: string; width: number; height: number },
  parameters: BeautyParameters,
): ColorMaskLayer {
  const face = kind === 'face'
  const body = kind === 'body'
  const acne = kind === 'acne'
  const spot = kind === 'spot'
  const id = face
    ? BEAUTY_FACE_LAYER_ID
    : body
      ? BEAUTY_BODY_LAYER_ID
      : acne
        ? BEAUTY_ACNE_LAYER_ID
        : spot
          ? BEAUTY_SPOT_LAYER_ID
          : BEAUTY_WRINKLE_LAYER_ID
  const name = face
    ? '美颜 · 面部皮肤'
    : body
      ? '美颜 · 身体皮肤'
      : acne
        ? '美颜 · 祛痘'
        : spot
          ? '美颜 · 淡斑'
          : '美颜 · 淡化皱纹'
  return {
    id,
    name,
    path: saved.path,
    width: saved.width,
    height: saved.height,
    opacity: 1,
    inverted: false,
    feather: 0,
    kind: 'semantic',
    modelId: body ? 'schp-atr-18-int8' : 'face-parsing-resnet18',
    enabled: true,
    blendMode: 'normal',
    color: face
      ? faceColor(parameters)
      : body
        ? bodyColor(parameters)
        : acne
          ? acneColor(parameters)
          : spot
            ? spotColor(parameters)
            : wrinkleColor(parameters),
  }
}

export function replaceBeautyLayers(
  face: ColorMaskLayer,
  body: ColorMaskLayer,
  acne: ColorMaskLayer,
  spot: ColorMaskLayer,
  wrinkle: ColorMaskLayer,
): ColorMaskLayer[] {
  return [body, face, spot, acne, wrinkle]
}

export interface BeautyClipboardSettings {
  parameters: BeautyParameters
  enabled: boolean
}

export function beautyClipboardSettings(pipeline: EditPipeline): BeautyClipboardSettings | undefined {
  const layers = beautyLayers(pipeline)
  if (!layers.face || !layers.body) return undefined
  return {
    parameters: beautyParameters(pipeline),
    enabled: Boolean(layers.face.enabled || layers.body.enabled || layers.acne?.enabled || layers.spot?.enabled || layers.wrinkle?.enabled),
  }
}

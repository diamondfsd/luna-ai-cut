import { createDefaultPipeline, type ColorMaskLayer, type EditPipeline } from '../shared/editPipeline'

export const BEAUTY_FACE_LAYER_ID = 'beauty-face-skin'
export const BEAUTY_BODY_LAYER_ID = 'beauty-body-skin'
export const BEAUTY_ACNE_LAYER_ID = 'beauty-acne'
export const BEAUTY_SPOT_LAYER_ID = 'beauty-spots'
export const BEAUTY_WRINKLE_LAYER_ID = 'beauty-wrinkles'
export const BEAUTY_MANUAL_RETOUCH_LAYER_ID = 'beauty-manual-retouch'
export const BEAUTY_BODY_MODEL_ID = 'schp-atr-resnet101-512'
export const BEAUTY_MASK_VERSION = 'beauty-mask-repair-v3'

export type BeautyMaskKind = 'face' | 'body' | 'acne' | 'spot' | 'wrinkle'

export interface BeautyParameters {
  faceWhitening: number
  skinWhitening: number
  skinWarmth: number
  smoothing: number
  texture: number
  acneRemoval: number
  spotRemoval: number
  wrinkleReduction: number
}

export const DEFAULT_BEAUTY_PARAMETERS: BeautyParameters = {
  // Natural retouch starts with skin cleanup only. Brightening is opt-in so
  // the face keeps its existing light and shadow structure.
  faceWhitening: 0,
  skinWhitening: 0,
  skinWarmth: 0,
  smoothing: 18,
  texture: 10,
  acneRemoval: 0,
  spotRemoval: 0,
  wrinkleReduction: 0,
}

const BODY_EXPOSURE_PER_STEP = 0.0008
const BODY_RENDER_EXPOSURE_PER_STEP = 0.003
const FACE_EXPOSURE_PER_STEP = 0.0012

function clampParameter(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function normalizedExposure(value: number): number {
  return Number(value.toFixed(4))
}

function smoothingForRendering(value: number): number {
  const normalized = clampParameter(value) / 100
  return Math.pow(normalized, 0.75) * 100
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
    skinWarmth: clampParameter(bodyColor?.temperature ?? 0),
    smoothing: clampParameter(Math.round(layers.face?.color.denoise ?? 0)),
    texture: clampParameter(Math.round(layers.face?.color.texture ?? 0)),
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

export function isBeautyAnalysisCurrent(pipeline: EditPipeline): boolean {
  const layers = beautyLayers(pipeline)
  const hasVideoTimeline = Boolean(layers.face?.timeline?.frames.length && layers.body?.timeline?.frames.length)
  return Boolean(
    hasVideoTimeline || (layers.face
      && layers.body?.modelId === BEAUTY_BODY_MODEL_ID
      && layers.body.className === BEAUTY_MASK_VERSION
      && layers.acne
      && layers.spot
      && layers.wrinkle),
  )
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
    temperature: clampParameter(parameters.skinWarmth ?? 0),
    denoise: parameters.smoothing,
    texture: parameters.texture,
  }
}

function bodyColor(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...createDefaultPipeline().color,
    exposure: normalizedExposure(parameters.skinWhitening * BODY_EXPOSURE_PER_STEP),
    highlights: -parameters.skinWhitening * 0.02,
    temperature: clampParameter(parameters.skinWarmth ?? 0),
  }
}

function skinWhiteningColorForRendering(value: number, warmth: number): Pick<EditPipeline['color'],
  'exposure' | 'temperature' | 'saturation' | 'highlights' | 'curveLift' | 'hslChannels'> {
  const color = createDefaultPipeline().color
  const channel = (key: 'red' | 'orange' | 'yellow', saturation: number, luminance: number) => ({
    ...color.hslChannels[key],
    saturation: -value * saturation,
    luminance: value * luminance,
  })
  return {
    exposure: normalizedExposure(value * BODY_RENDER_EXPOSURE_PER_STEP),
    temperature: clampParameter(warmth),
    saturation: -value * 0.025,
    // Do not lift the tonal curve: it erases the facial planes that make a
    // portrait read naturally. A small highlight recovery keeps bright skin
    // from clipping when the user explicitly adds brightness.
    highlights: -value * 0.06,
    curveLift: 0,
    hslChannels: {
      ...color.hslChannels,
      red: channel('red', 0.015, 0.008),
      orange: channel('orange', 0.03, 0.015),
      yellow: channel('yellow', 0.035, 0.01),
    },
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
    ...skinWhiteningColorForRendering(parameters.skinWhitening + parameters.faceWhitening, parameters.skinWarmth ?? 0),
    denoise: smoothingForRendering(parameters.smoothing),
    texture: parameters.texture * 0.35,
  }
}

function bodyColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  return {
    ...bodyColor(parameters),
    ...skinWhiteningColorForRendering(parameters.skinWhitening, parameters.skinWarmth ?? 0),
  }
}

function acneColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  const face = faceColorForRendering(parameters)
  return {
    ...face,
    exposure: normalizedExposure(face.exposure + 0.08),
    saturation: face.saturation - 12,
    highlights: face.highlights - 4,
    denoise: 1300,
    texture: 0,
    clarity: 0,
    sharpen: 0,
  }
}

function spotColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  const face = faceColorForRendering(parameters)
  return {
    ...face,
    exposure: normalizedExposure(face.exposure + 0.22),
    saturation: face.saturation - 10,
    denoise: 1900,
    texture: 0,
    clarity: 0,
    sharpen: 0,
  }
}

function wrinkleColorForRendering(parameters: BeautyParameters): EditPipeline['color'] {
  const face = faceColorForRendering(parameters)
  return {
    ...face,
    exposure: normalizedExposure(face.exposure + 0.02),
    denoise: 1300,
    texture: 0,
    clarity: 0,
    sharpen: 0,
  }
}

export function beautyLayerColorForRendering(
  pipeline: EditPipeline,
  layer: ColorMaskLayer,
): EditPipeline['color'] {
  const parameters = beautyParameters(pipeline)
  if (layer.id === BEAUTY_FACE_LAYER_ID) return faceColorForRendering(parameters)
  if (layer.id === BEAUTY_BODY_LAYER_ID) return bodyColorForRendering(parameters)
  if (layer.id === BEAUTY_ACNE_LAYER_ID) return acneColorForRendering(parameters)
  if (layer.id === BEAUTY_SPOT_LAYER_ID) return spotColorForRendering(parameters)
  if (layer.id === BEAUTY_WRINKLE_LAYER_ID) return wrinkleColorForRendering(parameters)
  if (layer.id === BEAUTY_MANUAL_RETOUCH_LAYER_ID) {
    const face = faceColorForRendering(parameters)
    return { ...face, denoise: 1900, texture: 0, clarity: 0, sharpen: 0 }
  }
  return layer.color
}

export function beautyLayerOpacityForRendering(
  _pipeline: EditPipeline,
  layer: ColorMaskLayer,
): number {
  if (layer.id === BEAUTY_ACNE_LAYER_ID || layer.id === BEAUTY_SPOT_LAYER_ID || layer.id === BEAUTY_WRINKLE_LAYER_ID) return 0
  return layer.opacity
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
    className: body ? BEAUTY_MASK_VERSION : undefined,
    modelId: body ? BEAUTY_BODY_MODEL_ID : 'face-parsing-resnet18',
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

export function createManualBeautyRetouchLayer(
  saved: { path: string; width: number; height: number },
  current?: ColorMaskLayer,
): ColorMaskLayer {
  return {
    id: BEAUTY_MANUAL_RETOUCH_LAYER_ID,
    name: '美颜 · 手动修复',
    path: saved.path,
    width: saved.width,
    height: saved.height,
    opacity: current?.opacity ?? 1,
    inverted: false,
    feather: 0,
    kind: 'brush',
    className: 'beauty-manual-retouch-v1',
    modelId: 'manual-healing-v1',
    enabled: current?.enabled ?? true,
    blendMode: 'normal',
    color: current?.color ?? createDefaultPipeline().color,
  }
}

export function replaceBeautyLayers(
  face: ColorMaskLayer,
  body: ColorMaskLayer,
  acne: ColorMaskLayer,
  spot: ColorMaskLayer,
  wrinkle: ColorMaskLayer,
): ColorMaskLayer[] {
  return [wrinkle, acne, spot, face, body]
}

export function replaceVideoBeautyLayers(face: ColorMaskLayer, body: ColorMaskLayer): ColorMaskLayer[] {
  return [face, body]
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
    enabled: Boolean(layers.face.enabled || layers.body.enabled),
  }
}

import { compositionRevealProgress } from '../../lib/revealProgress'
import type { PreviewLayer, RenderLayerTransform, WatermarkPositioning } from '../../shared/types'
import { PARAM_FLOAT_COUNT } from './webgpuGpu'

const DEFAULT_HSL_HUES = [0, 30, 60, 120, 180, 240, 285, 320]

const DEFAULT_RENDER_COLOR = {
  exposure: 0,
  black: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  texture: 0,
  sharpen: 0,
  denoise: 0,
  skinSmoothing: 0,
  glowStrength: 0,
  glowRadius: 35,
  glowThreshold: 65,
  gradeShadowsHue: 220,
  gradeShadowsAmount: 0,
  gradeMidHue: 35,
  gradeMidAmount: 0,
  gradeHighlightsHue: 42,
  gradeHighlightsAmount: 0,
  curveLift: 0,
  curveContrast: 0,
  curve: { rgb: [], luminance: [], red: [], green: [], blue: [] },
  levelsBlack: 0,
  levelsGray: 0.5,
  levelsWhite: 1,
  hslChannels: DEFAULT_HSL_HUES.map((hue) => ({ hue, hueShift: 0, saturation: 0, luminance: 0 })),
}

export function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Match the native compositor's source-time based pixel-flow timeline. */
export function pixelFlowProgressAt(layer: PreviewLayer, compositionTime: number): number {
  const effect = layer.pixelFlow
  if (!effect) return 0

  const explicitProgress = effect.progress
  if (typeof explicitProgress === 'number' && Number.isFinite(explicitProgress)) {
    return clamp(explicitProgress, 0, 1)
  }

  const sourceTime = Math.max(
    0,
    numberOr(layer.videoTime, 0) + numberOr(compositionTime, 0) - numberOr(layer.videoOffset, 0),
  )
  const duration = Math.max(0.1, numberOr(effect.duration, 1))
  return clamp(sourceTime / duration, 0, 1)
}

function parseHexColor(value: string | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
  const hex = value?.trim().replace(/^#/, '')
  if (!hex || (hex.length !== 6 && hex.length !== 8) || !/^[0-9a-f]+$/i.test(hex)) return fallback
  const byte = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return [byte(0), byte(2), byte(4), hex.length === 8 ? byte(6) : 1]
}

function shouldSwapOrientation(orientation: number): boolean {
  const normalized = ((orientation % 180) + 180) % 180
  return normalized >= 45 && normalized <= 135
}

function frameAspect(width: number, height: number, orientation: number): number {
  const sourceAspect = width / Math.max(1, height)
  return shouldSwapOrientation(orientation) ? 1 / Math.max(0.001, sourceAspect) : Math.max(0.001, sourceAspect)
}

export function positioningFor(
  positioning: PreviewLayer['positioning'],
  canvasWidth: number,
  canvasHeight: number,
): WatermarkPositioning | undefined {
  if (!positioning) return undefined
  if ('anchor' in positioning) return positioning
  return canvasWidth / Math.max(1, canvasHeight) >= 1 ? positioning.landscape : positioning.portrait
}

export function resolvePositioning(
  positioning: WatermarkPositioning | undefined,
  fallback: [number, number, number, number],
  canvasWidth: number,
  canvasHeight: number,
  textureWidth: number,
  textureHeight: number,
): [number, number, number, number] {
  if (!positioning) return fallback
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight)
  const textureAspect = textureWidth / Math.max(1, textureHeight)
  const dstW = positioning.targetWidth
  const dstH = dstW * canvasAspect / Math.max(0.001, textureAspect)
  const marginX = positioning.marginX ?? 0
  const marginY = positioning.marginY ?? 0
  switch (positioning.anchor) {
    case 'top-left': return [marginX, marginY, dstW, dstH]
    case 'top-center': return [(1 - dstW) / 2, marginY, dstW, dstH]
    case 'top-right': return [1 - dstW - marginX, marginY, dstW, dstH]
    case 'bottom-left': return [marginX, 1 - dstH - marginY, dstW, dstH]
    case 'bottom-center': return [(1 - dstW) / 2, 1 - dstH - marginY, dstW, dstH]
    case 'bottom-right': return [1 - dstW - marginX, 1 - dstH - marginY, dstW, dstH]
    case 'center': return [(1 - dstW) / 2, (1 - dstH) / 2, dstW, dstH]
    default: return fallback
  }
}

export function planCoverTransform(
  layer: PreviewLayer,
  transform: RenderLayerTransform,
  textureWidth: number,
  textureHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  positioning: WatermarkPositioning | undefined,
): RenderLayerTransform {
  if (layer.fit !== 'cover' || positioning) return transform
  const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const cropW = clamp(crop.w, 0.001, 1)
  const cropH = clamp(crop.h, 0.001, 1)
  const cropX = clamp(crop.x, 0, 1 - cropW)
  const cropY = clamp(crop.y, 0, 1 - cropH)
  const visibleAspect = frameAspect(textureWidth, textureHeight, transform.orientation) * cropW / Math.max(0.001, cropH)
  const layerPixelW = Math.max(1, layer.dstW * canvasWidth)
  const layerPixelH = Math.max(1, layer.dstH * canvasHeight)
  const targetAspect = layerPixelW / layerPixelH
  if (visibleAspect > targetAspect) {
    const nextW = clamp(cropW * targetAspect / visibleAspect, 0.001, cropW)
    return { ...transform, crop: { x: cropX + (cropW - nextW) / 2, y: cropY, w: nextW, h: cropH } }
  }
  const nextH = clamp(cropH * visibleAspect / Math.max(0.001, targetAspect), 0.001, cropH)
  return { ...transform, crop: { x: cropX, y: cropY + (cropH - nextH) / 2, w: cropW, h: nextH } }
}

export function planCoverScale(
  transform: RenderLayerTransform,
  textureWidth: number,
  textureHeight: number,
  targetAspect: number,
): { transform: RenderLayerTransform; frame: [number, number] } {
  const sourceAspect = textureWidth / Math.max(1, textureHeight)
  const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const cropW = clamp(crop.w, 0.001, 1)
  const cropH = clamp(crop.h, 0.001, 1)
  const cropX = clamp(crop.x, 0, 1 - cropW)
  const cropY = clamp(crop.y, 0, 1 - cropH)
  const frameW = targetAspect * cropH / cropW
  const frameH = 1
  const swapsAxes = shouldSwapOrientation(transform.orientation)
  const originalFrameW = swapsAxes ? 1 : sourceAspect
  const originalFrameH = swapsAxes ? sourceAspect : 1
  const baseScale = swapsAxes
    ? Math.max(frameW, frameH / Math.max(0.001, sourceAspect))
    : Math.max(frameW / Math.max(0.001, sourceAspect), frameH)
  const centerX = cropX + cropW / 2
  const centerY = cropY + cropH / 2
  const translateX = (centerX - 0.5) * frameW / baseScale - (centerX - 0.5) * originalFrameW
  const translateY = (centerY - 0.5) * frameH / baseScale - (centerY - 0.5) * originalFrameH
  return {
    transform: {
      ...transform,
      scale: transform.scale * baseScale,
      translateX: (transform.translateX ?? 0) + translateX,
      translateY: (transform.translateY ?? 0) + translateY,
    },
    frame: [frameW, frameH],
  }
}

function writeVec4(target: Float32Array, offset: { value: number }, values: [number, number, number, number]): void {
  target.set(values, offset.value)
  offset.value += 4
}

function writeScalar(target: Float32Array, offset: { value: number }, value: number): void {
  target[offset.value] = value
  offset.value += 1
}

function writeMatrixRows(target: Float32Array, offset: { value: number }, rows: number[][]): void {
  for (const row of rows) {
    writeVec4(target, offset, [numberOr(row[0], 0), numberOr(row[1], 0), numberOr(row[2], 0), numberOr(row[3], 0)])
  }
}

function writeColorCurveToRows(rows: number[][], base: number, points: Array<{ x: number; y: number }> | undefined): number {
  const count = Math.min(12, points?.length ?? 0)
  for (let index = 0; index < count; index += 1) {
    const point = points?.[index]
    if (!point) continue
    const row = base + Math.floor(index / 2)
    const column = (index % 2) * 2
    rows[row][column] = clamp(numberOr(point.x, 0), 0, 1)
    rows[row][column + 1] = clamp(numberOr(point.y, 0), 0, 1)
  }
  return count
}

export function createLayerParams(
  layer: PreviewLayer,
  textureWidth: number,
  textureHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  maskPresent: boolean,
  maskTransform: { translateX: number; translateY: number; scale: number; rotation: number } | undefined,
  revealProgress: number,
  plannedTransform: RenderLayerTransform,
  resolvedRect: [number, number, number, number],
  frame: [number, number] | undefined,
  restoreLutSize: number,
  lutSize: number,
  compositionTime: number,
  hdrOutput = false,
): Float32Array {
  const data = new Float32Array(PARAM_FLOAT_COUNT)
  const offset = { value: 0 }
  const color = layer.color ?? DEFAULT_RENDER_COLOR
  const curve = color.curve ?? DEFAULT_RENDER_COLOR.curve
  const layerType = layer.layerType ?? 'media'
  const proceduralKind = layerType === 'shape' ? 1 : layerType === 'text' || layerType === 'logo' ? 3 : 0
  const shapeKind = layer.shape === 'rounded-rectangle' ? 1 : layer.shape === 'line' ? 2 : layer.shape === 'circle' ? 3 : 0
  const transformCrop = plannedTransform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const textAlign = layer.textAlign === 'center' ? 1 : layer.textAlign === 'right' ? 2 : 0
  const verticalAlign = layer.verticalAlign === 'top' ? 0 : layer.verticalAlign === 'bottom' ? 2 : 1
  const ascii = Array.from(layer.content ?? '').slice(0, 128).map((character) => {
    const code = character.charCodeAt(0)
    return code >= 0 && code <= 127 ? code : 63
  })
  const curveData = Array.from({ length: 30 }, () => [0, 0, 0, 0])
  const curveRgbCount = writeColorCurveToRows(curveData, 0, curve.rgb)
  const curveLuminanceCount = writeColorCurveToRows(curveData, 6, curve.luminance)
  const curveRedCount = writeColorCurveToRows(curveData, 12, curve.red)
  const curveGreenCount = writeColorCurveToRows(curveData, 18, curve.green)
  const curveBlueCount = writeColorCurveToRows(curveData, 24, curve.blue)
  const hslData = DEFAULT_HSL_HUES.map((hue, index) => {
    const channel = color.hslChannels?.[index]
    return [
      clamp(numberOr(channel?.hue, hue), 0, 360),
      clamp(numberOr(channel?.hueShift, 0), -180, 180),
      clamp(numberOr(channel?.saturation, 0), -100, 100),
      clamp(numberOr(channel?.luminance, 0), -100, 100),
    ]
  })
  for (let index = DEFAULT_HSL_HUES.length; index < 12; index += 1) {
    const channel = color.hslChannels?.[index]
    hslData.push([
      clamp(numberOr(channel?.hue, 0), 0, 360),
      clamp(numberOr(channel?.hueShift, 0), -180, 180),
      clamp(numberOr(channel?.saturation, 0), -100, 100),
      clamp(numberOr(channel?.luminance, 0), -100, 100),
    ])
  }
  const pixelStretch = layer.pixelStretch
  const horizontalStretch = pixelStretch ? ['left', 'right', 'horizontal'].includes(pixelStretch.mode) : false
  const stretchMode = pixelStretch
    ? ({ right: 1, down: 2, swirl: 3, 'swirl-front': 4, left: 5, up: 6, horizontal: 7, vertical: 8 }[pixelStretch.mode] ?? 0)
    : 0
  const stretchPath = pixelStretch?.pathPoints?.length === 14 ? pixelStretch.pathPoints : []
  const pixelFlow = layer.pixelFlow
  const subjectDirection = ({ up: 1, right: 2, left: 3, outward: 4, inward: 5 } as Record<string, number>)[pixelFlow?.subjectDirection ?? 'down'] ?? 0
  const fill = proceduralKind > 1.5
    ? parseHexColor(layer.textColor, [1, 1, 1, 1])
    : parseHexColor(layer.fillColor, [1, 1, 1, 1])
  const stroke = parseHexColor(layer.strokeColor, [0, 0, 0, 0])

  const [dstX, dstY, dstW, dstH] = resolvedRect
  const sourceAspect = textureWidth / Math.max(1, textureHeight)
  const effectiveFrame = frame ?? (shouldSwapOrientation(plannedTransform.orientation) ? [1, sourceAspect] : [sourceAspect, 1])

  writeVec4(data, offset, [dstX * canvasWidth, dstY * canvasHeight, dstW * canvasWidth, dstH * canvasHeight])
  writeVec4(data, offset, [numberOr(layer.srcX, 0), numberOr(layer.srcY, 0), numberOr(layer.srcW, 1), numberOr(layer.srcH, 1)])
  writeVec4(data, offset, [transformCrop.x, transformCrop.y, transformCrop.w, transformCrop.h])
  writeVec4(data, offset, [sourceAspect, effectiveFrame[0], effectiveFrame[1], numberOr(layer.opacity, 1)])
  for (const value of [
    color.exposure, color.black, color.brightness, color.contrast, color.saturation, color.vibrance,
    color.temperature, color.tint, color.highlights, color.shadows, color.whites, color.blacks,
    color.clarity, color.texture, color.sharpen, color.denoise,
  ]) writeScalar(data, offset, numberOr(value, 0))
  writeVec4(data, offset, [
    clamp(numberOr(color.glowStrength, 0), 0, 100),
    clamp(numberOr(color.glowRadius, 35), 1, 100),
    clamp(numberOr(color.glowThreshold, 65), 0, 100),
    clamp(numberOr(color.skinSmoothing, 0), 0, 100),
  ])
  for (const value of [
    color.gradeShadowsHue, color.gradeShadowsAmount, color.gradeMidHue, color.gradeMidAmount,
    color.gradeHighlightsHue, color.gradeHighlightsAmount, color.curveLift, color.curveContrast,
    color.levelsBlack, color.levelsGray, color.levelsWhite,
    curveRgbCount, curveLuminanceCount, curveRedCount, curveGreenCount, curveBlueCount,
    1 / Math.max(1, textureWidth), 1 / Math.max(1, textureHeight),
    numberOr(plannedTransform.orientation, 0), numberOr(plannedTransform.rotate, 0), plannedTransform.flipH ? 1 : 0,
    plannedTransform.flipV ? 1 : 0, Math.max(0.0001, numberOr(plannedTransform.scale, 1)),
    numberOr(plannedTransform.translateX, 0), numberOr(plannedTransform.translateY, 0),
    restoreLutSize, lutSize, numberOr(layer.lutIntensity, 100),
    positioningFor(layer.positioning, canvasWidth, canvasHeight) ? 1 : 0,
  ]) writeScalar(data, offset, numberOr(value, 0))
  writeScalar(data, offset, hdrOutput ? 1 : 0)
  offset.value += 2
  writeVec4(data, offset, [
    maskPresent ? clamp(numberOr(layer.maskOpacity, 1), 0, 1) : 1,
    maskPresent && layer.maskInverted ? 1 : 0,
    maskPresent ? clamp(numberOr(layer.maskFeather, 0), 0, 100) : 0,
    maskPresent && layer.layerType === 'local-color' ? 1 : 0,
  ])
  writeVec4(data, offset, [
    numberOr(maskTransform?.translateX, 0),
    numberOr(maskTransform?.translateY, 0),
    clamp(numberOr(maskTransform?.scale, 1), 0.1, 10),
    numberOr(maskTransform?.rotation, 0),
  ])
  writeVec4(data, offset, [proceduralKind, proceduralKind > 1.5 ? verticalAlign : shapeKind, numberOr(layer.cornerRadius, 0), numberOr(layer.strokeWidth, 0)])
  writeVec4(data, offset, [stretchMode, clamp(numberOr(pixelStretch?.intensity, 0), 0, 100), clamp(numberOr(pixelStretch?.originX, 0.5), 0, 1), clamp(numberOr(pixelStretch?.originY, 0.5), 0, 1)])
  writeVec4(data, offset, [
    clamp(numberOr(pixelStretch?.angle, 0), -180, 180),
    clamp(numberOr(pixelStretch?.lineEnd ?? (horizontalStretch ? pixelStretch?.originX : pixelStretch?.originY), 0), 0, 1),
    clamp(numberOr(pixelStretch?.sampleStart, 0), 0, 1),
    clamp(numberOr(pixelStretch?.sampleEnd, 1), 0, 1),
  ])
  writeVec4(data, offset, [
    clamp(numberOr(pixelStretch?.centerX, 0.5), 0, 1),
    clamp(numberOr(pixelStretch?.centerY, 0.5), 0, 1),
    clamp(numberOr(pixelStretch?.controlStart ?? (horizontalStretch ? pixelStretch?.originX : pixelStretch?.originY), 0), 0, 1),
    clamp(numberOr(pixelStretch?.controlEnd ?? pixelStretch?.lineEnd ?? (horizontalStretch ? pixelStretch?.originX : pixelStretch?.originY), 0), 0, 1),
  ])
  writeVec4(data, offset, [stretchPath.length === 14 ? 1 : 0, clamp(numberOr(pixelStretch?.pathStartWidth, 0.2), 0.001, 2), clamp(numberOr(pixelStretch?.pathEndWidth, 0.1), 0.001, 2), pixelStretch?.fillSampleGaps ? 1 : 0])
  writeMatrixRows(data, offset, Array.from({ length: 4 }, (_, row) => [
    stretchPath[row * 2] ?? 0, stretchPath[row * 2 + 1] ?? 0, stretchPath[row * 2 + 2] ?? 0, stretchPath[row * 2 + 3] ?? 0,
  ]))
  writeVec4(data, offset, [pixelFlow ? 1 : 0, pixelFlowProgressAt(layer, compositionTime), clamp(numberOr(pixelFlow?.pixelCount, 500), 24, 500), clamp(numberOr(pixelFlow?.lightWidth, 32), 1, 32)])
  writeVec4(data, offset, [
    clamp(numberOr(pixelFlow?.rainLength, 58), 0, 100) / 100,
    clamp(numberOr(pixelFlow?.flowStrength, 78), 0, 100) / 100,
    clamp(numberOr(pixelFlow?.subjectDelay, 34), 0, 100) / 100,
    0,
  ])
  writeVec4(data, offset, [clamp(numberOr(pixelFlow?.duration, 1), 0.1, 3), pixelFlow?.segmented ? 1 : 0, 0, 0])
  writeVec4(data, offset, [clamp(numberOr(pixelFlow?.initialSaturation, 0), 0, 100) / 100, clamp(numberOr(pixelFlow?.initialBrightness, 0), -100, 100) / 100, subjectDirection, 0])
  writeVec4(data, offset, [clamp(numberOr(pixelFlow?.bloomStrength, 50), 0, 100) / 100, clamp(numberOr(pixelFlow?.filterStrength, 50), 0, 100) / 100, clamp(numberOr(pixelFlow?.colorTransition, 0.5), 0, 2), 0])
  writeVec4(data, offset, fill)
  writeVec4(data, offset, stroke)
  writeVec4(data, offset, [numberOr(layer.fontSize, 16) * canvasHeight / 1080, textAlign, ascii.length, clamp(revealProgress, 0, 1)])
  const textRows = Array.from({ length: 32 }, (_, row) => [
    ascii[row * 4] ?? 0, ascii[row * 4 + 1] ?? 0, ascii[row * 4 + 2] ?? 0, ascii[row * 4 + 3] ?? 0,
  ])
  writeMatrixRows(data, offset, textRows)
  writeMatrixRows(data, offset, curveData)
  writeMatrixRows(data, offset, hslData)
  if (offset.value !== PARAM_FLOAT_COUNT) throw new Error(`WebGPU 参数布局不匹配: ${offset.value}/${PARAM_FLOAT_COUNT}`)
  return data
}

export function layerRevealProgress(layer: PreviewLayer, time: number): number {
  return layer.reveal ? compositionRevealProgress(layer.reveal, time) : 1
}

export type LayerRect = [number, number, number, number]

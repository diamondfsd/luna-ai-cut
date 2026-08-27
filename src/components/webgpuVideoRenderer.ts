import { compositionRevealProgress } from '../lib/revealProgress'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type {
  PreviewLayer,
  RenderColorAdjustments,
  RenderLayerTransform,
  WatermarkPositioning,
} from '../shared/types'
import { maskTimelineSampleAt } from '../workspace/mask/maskTimeline'
import { maskTrackTransformAt } from '../workspace/mask/maskTrack'
import {
  calcRenderSize,
  computeLayerDecodeMaxSide,
  videoLayerKey,
} from './multipleLayerVideoFrameRenderer'
import { WEBGPU_COMPOSITOR_SHADER } from './webgpuShader'
import { encodeWebGpuColorMask, parseWebGpuCube } from './webgpuPreviewMath'
import { rasterizeWebGpuText, webGpuFontFamily } from './webgpuTextRaster'

type GpuTextureView = object
type GpuSampler = object
type GpuShaderModule = {
  getCompilationInfo?: () => Promise<{ messages?: Array<{ type?: string; message?: string; lineNum?: number }> }>
}
type GpuBuffer = {
  destroy?: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}
type GpuTexture = {
  createView: (descriptor?: unknown) => GpuTextureView
  destroy?: () => void
}
type GpuPipeline = object
type GpuBindGroup = object
type GpuCommandBuffer = object

interface GpuRenderPass {
  setPipeline: (pipeline: GpuPipeline) => void
  setBindGroup: (index: number, bindGroup: GpuBindGroup) => void
  draw: (vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number) => void
  end: () => void
}

interface GpuCommandEncoder {
  beginRenderPass: (descriptor: unknown) => GpuRenderPass
  copyTextureToTexture: (source: unknown, destination: unknown, copySize: unknown) => void
  copyTextureToBuffer: (source: unknown, destination: unknown, copySize: unknown) => void
  finish: () => GpuCommandBuffer
}

interface GpuQueue {
  writeBuffer: (buffer: GpuBuffer, bufferOffset: number, data: ArrayBufferView) => void
  writeTexture: (destination: unknown, data: ArrayBufferView, dataLayout: unknown, size: unknown) => void
  copyExternalImageToTexture: (source: unknown, destination: unknown, copySize: unknown) => void
  submit: (commands: GpuCommandBuffer[]) => void
  onSubmittedWorkDone?: () => Promise<void>
}

interface GpuDevice {
  queue: GpuQueue
  lost: Promise<{ reason?: string; message?: string }>
  createShaderModule: (descriptor: unknown) => GpuShaderModule
  createBindGroupLayout: (descriptor: unknown) => object
  createPipelineLayout: (descriptor: unknown) => object
  createRenderPipeline: (descriptor: unknown) => GpuPipeline
  createSampler: (descriptor: unknown) => GpuSampler
  createTexture: (descriptor: unknown) => GpuTexture
  createBuffer: (descriptor: unknown) => GpuBuffer
  createBindGroup: (descriptor: unknown) => GpuBindGroup
  createCommandEncoder: (descriptor?: unknown) => GpuCommandEncoder
}

interface GpuAdapter {
  requestDevice: (descriptor?: unknown) => Promise<GpuDevice>
}

interface GpuNavigator {
  requestAdapter: (options?: unknown) => Promise<GpuAdapter | null>
  getPreferredCanvasFormat: () => string
}

interface GpuCanvasContext {
  configure: (descriptor: unknown) => void
  getCurrentTexture: () => GpuTexture
}

interface ExternalImageResource {
  source: HTMLImageElement | HTMLVideoElement
  width: number
  height: number
  ownedUrl?: string
}

interface GpuImageResource {
  texture: GpuTexture
  width: number
  height: number
  external?: ExternalImageResource
}

interface GpuVideoEntry {
  key: string
  video: HTMLVideoElement
  ready: boolean
  resource: GpuImageResource | null
  lastUploadedFrame: number
}

interface GpuMaskResource {
  texture: GpuTexture
  width: number
  height: number
}

interface GpuLutResource {
  texture: GpuTexture
  size: number
}

interface WebGpuVideoRendererOptions {
  canvasWidth: number
  canvasHeight: number
  maxSide: number
  waitForGpu?: boolean
  rasterizeImages?: boolean
  onVideoElement: (element: HTMLMediaElement | null) => void
  onFallback: (reason: string) => void
  onRender: () => void
}

const TEXTURE_USAGE_COPY_SRC = 0x01
const TEXTURE_USAGE_COPY_DST = 0x02
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10
const BUFFER_USAGE_UNIFORM = 0x40
const PARAM_FLOAT_COUNT = 440
const IDENTITY_MASK_RGBA = new Uint8Array([255, 255, 255, 255])
const IDENTITY_SOURCE_RGBA = new Uint8Array([255, 255, 255, 255])

const DEFAULT_HSL_HUES = [0, 30, 60, 120, 180, 240, 285, 320]

const DEFAULT_RENDER_COLOR: RenderColorAdjustments = {
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

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function positioningFor(
  positioning: PreviewLayer['positioning'],
  canvasWidth: number,
  canvasHeight: number,
): WatermarkPositioning | undefined {
  if (!positioning) return undefined
  if ('anchor' in positioning) return positioning
  return canvasWidth / Math.max(1, canvasHeight) >= 1 ? positioning.landscape : positioning.portrait
}

function resolvePositioning(
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

function planCoverTransform(
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

function planCoverScale(
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
    writeVec4(target, offset, [
      numberOr(row[0], 0),
      numberOr(row[1], 0),
      numberOr(row[2], 0),
      numberOr(row[3], 0),
    ])
  }
}

function createLayerParams(
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
  offset.value += 3
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
    numberOr(stretchPath[row * 4], 0), numberOr(stretchPath[row * 4 + 1], 0), numberOr(stretchPath[row * 4 + 2], 0), numberOr(stretchPath[row * 4 + 3], 0),
  ]))
  writeVec4(data, offset, [pixelFlow ? 1 : 0, clamp(numberOr(pixelFlow?.progress, 0), 0, 1), clamp(numberOr(pixelFlow?.pixelCount, 500), 24, 500), clamp(numberOr(pixelFlow?.lightWidth, 32), 1, 32)])
  writeVec4(data, offset, [
    clamp(numberOr(pixelFlow?.rainSpeed, 50), 0, 100) / 100,
    clamp(numberOr(pixelFlow?.rainLength, 58), 0, 100) / 100,
    clamp(numberOr(pixelFlow?.flowStrength, 78), 0, 100) / 100,
    clamp(numberOr(pixelFlow?.subjectDelay, 34), 0, 100) / 100,
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

function getWebGpuNavigator(): GpuNavigator | null {
  return (navigator as Navigator & { gpu?: GpuNavigator }).gpu ?? null
}

function getWebGpuContext(canvas: HTMLCanvasElement): GpuCanvasContext | null {
  return (canvas.getContext as (contextId: string, options?: unknown) => unknown).call(canvas, 'webgpu') as GpuCanvasContext | null
}

function createTexture(device: GpuDevice, width: number, height: number, format: string, usages: number, depth = 1): GpuTexture {
  return device.createTexture({
    size: { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: depth },
    dimension: depth > 1 ? '3d' : '2d',
    format,
    usage: usages,
  })
}

function srgbFormatFor(format: string): string {
  if (format === 'rgba8unorm') return 'rgba8unorm-srgb'
  if (format === 'bgra8unorm') return 'bgra8unorm-srgb'
  return format
}

function writeTexture(device: GpuDevice, texture: GpuTexture, data: Uint8Array, width: number, height: number, depth = 1): void {
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: Math.max(4, width * 4), rowsPerImage: Math.max(1, height) },
    { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: depth },
  )
}

export class WebGpuVideoRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly options: WebGpuVideoRendererOptions
  private readonly videos = new Map<string, GpuVideoEntry>()
  private readonly images = new Map<string, GpuImageResource>()
  private readonly masks = new Map<string, GpuMaskResource>()
  private readonly luts = new Map<string, GpuLutResource>()
  private readonly textTextures = new Map<string, GpuImageResource>()
  private readonly fontFamilies = new Map<string, Promise<string>>()
  private readonly precompositions = new Map<string, GpuImageResource>()
  private readonly paramsBuffers = new Map<number, GpuBuffer>()
  private readonly ownedObjectUrls = new Set<string>()
  private readonly pipelines = new Map<string, GpuPipeline>()
  private device: GpuDevice | null = null
  private context: GpuCanvasContext | null = null
  private bindGroupLayout: object | null = null
  private pipelineLayout: object | null = null
  private sampler: GpuSampler | null = null
  private identitySource: GpuImageResource | null = null
  private identityMask: GpuMaskResource | null = null
  private identityLut: GpuLutResource | null = null
  private shader: GpuShaderModule | null = null
  private canvasFormat = ''
  private presentationFormat = ''
  private outputTexture: GpuImageResource | null = null
  private layers: PreviewLayer[] = []
  private compositionTime = 0
  private playing = false
  private active = true
  private initialized = false
  private destroyed = false
  private renderInFlight = false
  private renderQueued = false
  private renderRevision = 0
  private frameCounter = 0
  private renderFrameId = 0
  private playbackFrameId = 0
  private currentPrimaryVideo: HTMLVideoElement | null = null

  constructor(canvas: HTMLCanvasElement, options: WebGpuVideoRendererOptions) {
    this.canvas = canvas
    this.options = options
  }

  async initialize(): Promise<void> {
    const gpu = getWebGpuNavigator()
    if (!gpu) throw new Error('当前版本没有可用的 WebGPU 画面加速能力')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('当前设备没有可用的 WebGPU 画面加速设备')
    const device = await adapter.requestDevice()
    const context = getWebGpuContext(this.canvas)
    if (!context) throw new Error('当前窗口无法创建 WebGPU 画布')
    this.device = device
    this.context = context
    this.presentationFormat = gpu.getPreferredCanvasFormat()
    this.canvasFormat = srgbFormatFor(this.presentationFormat)
    context.configure({
      device,
      format: this.presentationFormat,
      usage: TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER_ATTACHMENT,
      alphaMode: 'premultiplied',
    })
    this.createGpuObjects()
    const compilationInfo = await this.shader?.getCompilationInfo?.()
    const compilationErrors = compilationInfo?.messages?.filter((message) => message.type === 'error') ?? []
    if (compilationErrors.length > 0) {
      const detail = compilationErrors[0]
      throw new Error(`WebGPU 画面着色器不可用${detail.message ? `: ${detail.message}` : ''}`)
    }
    this.initialized = true
    void device.lost.then((info) => {
      if (this.destroyed) return
      this.fail(`WebGPU 设备已停止工作${info.message ? `: ${info.message}` : ''}`)
    })
  }

  async setLayers(layers: PreviewLayer[]): Promise<void> {
    if (!this.initialized || this.destroyed) return
    this.layers = layers
    this.renderRevision += 1
    await this.syncVideoElements()
    if (!this.destroyed) this.scheduleRender()
  }

  async setPlayback(active: boolean, playing: boolean, time: number): Promise<void> {
    if (this.destroyed) return
    this.active = active
    this.playing = playing
    this.compositionTime = Math.max(0, Number.isFinite(time) ? time : 0)
    for (const entry of this.videos.values()) {
      if (!entry.ready) continue
      if (playing && active) await entry.video.play().catch(() => undefined)
      else entry.video.pause()
    }
    if (playing && active) this.schedulePlaybackLoop()
    this.scheduleRender()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.renderFrameId) cancelAnimationFrame(this.renderFrameId)
    if (this.playbackFrameId) cancelAnimationFrame(this.playbackFrameId)
    for (const entry of this.videos.values()) {
      entry.video.pause()
      entry.video.removeAttribute('src')
      entry.video.load()
      entry.resource?.texture.destroy?.()
    }
    this.videos.clear()
    for (const resource of this.images.values()) resource.texture.destroy?.()
    for (const resource of this.masks.values()) resource.texture.destroy?.()
    for (const resource of this.luts.values()) resource.texture.destroy?.()
    for (const resource of this.textTextures.values()) resource.texture.destroy?.()
    for (const resource of this.precompositions.values()) resource.texture.destroy?.()
    this.outputTexture?.texture.destroy?.()
    this.identitySource?.texture.destroy?.()
    this.identityMask?.texture.destroy?.()
    this.identityLut?.texture.destroy?.()
    for (const buffer of this.paramsBuffers.values()) buffer.destroy?.()
    for (const objectUrl of this.ownedObjectUrls) URL.revokeObjectURL(objectUrl)
    this.images.clear()
    this.masks.clear()
    this.luts.clear()
    this.textTextures.clear()
    this.fontFamilies.clear()
    this.precompositions.clear()
    this.outputTexture = null
    this.paramsBuffers.clear()
    this.options.onVideoElement(null)
  }

  private createGpuObjects(): void {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    this.shader = device.createShaderModule({ code: WEBGPU_COMPOSITOR_SHADER })
    this.bindGroupLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', hasDynamicOffset: false, minBindingSize: PARAM_FLOAT_COUNT * 4 } },
      { binding: 3, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d', multisampled: false } },
      { binding: 4, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 5, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
      { binding: 6, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d', multisampled: false } },
    ] })
    this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] })
    this.sampler = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest' })
    const sourceTexture = createTexture(device, 1, 1, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, sourceTexture, IDENTITY_SOURCE_RGBA, 1, 1)
    this.identitySource = { texture: sourceTexture, width: 1, height: 1 }
    const maskTexture = createTexture(device, 1, 1, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, maskTexture, IDENTITY_MASK_RGBA, 1, 1)
    this.identityMask = { texture: maskTexture, width: 1, height: 1 }
    const lutTexture = createTexture(device, 2, 2, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING, 2)
    const identityLut = new Uint8Array(2 * 2 * 2 * 4)
    for (let z = 0; z < 2; z += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
      const index = (z * 4 + y * 2 + x) * 4
      identityLut[index] = x * 255
      identityLut[index + 1] = y * 255
      identityLut[index + 2] = z * 255
      identityLut[index + 3] = 255
    }
    writeTexture(device, lutTexture, identityLut, 2, 2, 2)
    this.identityLut = { texture: lutTexture, size: 0 }
  }

  private pipelineFor(blendMode: PreviewLayer['blendMode']): GpuPipeline {
    const device = this.device
    if (!device || !this.shader || !this.pipelineLayout) throw new Error('WebGPU 管线未初始化')
    const key = blendMode ?? 'normal'
    const cached = this.pipelines.get(key)
    if (cached) return cached
    const alpha = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    const color = key === 'multiply'
      ? { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      : key === 'screen'
        ? { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }
        : key === 'add'
          ? { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
          : alpha
    const pipeline = device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module: this.shader, entryPoint: 'vs_main' },
      fragment: { module: this.shader, entryPoint: 'fs_main', targets: [{ format: this.canvasFormat, blend: { color, alpha }, writeMask: 0xF }] },
      primitive: { topology: 'triangle-strip' },
    })
    this.pipelines.set(key, pipeline)
    return pipeline
  }

  private schedulePlaybackLoop(): void {
    if (this.destroyed || !this.playing || !this.active || this.playbackFrameId) return
    this.playbackFrameId = requestAnimationFrame(() => {
      this.playbackFrameId = 0
      this.scheduleRender()
      this.schedulePlaybackLoop()
    })
  }

  private scheduleRender(): void {
    if (this.destroyed || this.renderFrameId) return
    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = 0
      void this.render()
    })
  }

  private fail(reason: string): void {
    if (this.destroyed) return
    this.options.onFallback(reason)
  }

  private async syncVideoElements(): Promise<void> {
    const required = new Map<string, PreviewLayer>()
    for (const layer of this.layers) {
      if (layer.isVideo) required.set(videoLayerKey(layer), layer)
    }
    const audioEnabledKey = required.size === 1 ? required.keys().next().value : null
    for (const [key, entry] of this.videos) {
      if (required.has(key)) continue
      entry.video.pause()
      entry.video.removeAttribute('src')
      entry.video.load()
      entry.resource?.texture.destroy?.()
      this.videos.delete(key)
    }
    for (const [key, layer] of required) {
      const existing = this.videos.get(key)
      if (existing) {
        existing.video.muted = key !== audioEnabledKey
        continue
      }
      const video = document.createElement('video')
      video.preload = 'auto'
      video.playsInline = true
      video.loop = false
      video.muted = key !== audioEnabledKey
      video.crossOrigin = 'anonymous'
      video.src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath
      const entry: GpuVideoEntry = { key, video, ready: false, resource: null, lastUploadedFrame: -1 }
      video.addEventListener('loadeddata', () => {
        if (this.destroyed || this.videos.get(key) !== entry) return
        entry.ready = true
        this.scheduleRender()
      })
      video.addEventListener('loadedmetadata', () => this.updatePrimaryVideo())
      video.addEventListener('seeked', () => this.scheduleRender())
      video.addEventListener('timeupdate', () => {
        if (!this.playing) this.scheduleRender()
      })
      video.addEventListener('error', () => {
        if (this.destroyed || video.error?.code === 4) return
        this.fail(`视频无法在 WebGPU 预览中打开（错误代码 ${video.error?.code ?? '未知'}）`)
      })
      this.videos.set(key, entry)
      video.load()
    }
    this.updatePrimaryVideo()
    for (const entry of this.videos.values()) {
      if (entry.ready && this.playing && this.active) await entry.video.play().catch(() => undefined)
    }
  }

  private updatePrimaryVideo(): void {
    const primaryLayer = this.layers.find((layer) => layer.isVideo)
    const primary = primaryLayer ? this.videos.get(videoLayerKey(primaryLayer))?.video ?? null : null
    if (primary === this.currentPrimaryVideo) return
    this.currentPrimaryVideo = primary
    this.options.onVideoElement(primary)
  }

  private currentPlaybackCompositionTime(): number {
    const primaryLayer = this.layers.find((layer) => layer.isVideo)
    const primaryVideo = primaryLayer
      ? this.videos.get(videoLayerKey(primaryLayer))?.video
      : undefined
    if (!this.playing || !primaryLayer || !primaryVideo || !Number.isFinite(primaryVideo.currentTime)) {
      return this.compositionTime
    }
    return Math.max(
      0,
      primaryVideo.currentTime
        - numberOr(primaryLayer.videoTime, 0)
        + numberOr(primaryLayer.videoOffset, 0),
    )
  }

  private syncVideoClocks(): void {
    const playbackTime = this.currentPlaybackCompositionTime()
    if (this.playing) this.compositionTime = playbackTime
    for (const layer of this.layers) {
      if (!layer.isVideo) continue
      const entry = this.videos.get(videoLayerKey(layer))
      if (!entry?.ready) continue
      // 播放时主视频自身就是时钟，不能用低频的 React timeupdate 反向拉回它。
      // 其他视频层仍跟随主视频的合成时间，避免多视频素材逐渐漂移。
      if (this.playing && entry.video === this.currentPrimaryVideo) continue
      const target = Math.max(0, numberOr(layer.videoTime, 0) + playbackTime - numberOr(layer.videoOffset, 0))
      const threshold = this.playing ? 0.15 : 0.01
      if (Math.abs(entry.video.currentTime - target) > threshold) entry.video.currentTime = target
    }
  }

  private async loadImage(path: string): Promise<ExternalImageResource> {
    const directUrl = filePathToPreviewUrl(path) ?? path
    const load = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(`图片无法在 WebGPU 预览中打开: ${path}`))
      image.src = url
    })
    try {
      const image = await load(directUrl)
      return { source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
    } catch {
      const preview = await window.luna.workspace.loadPreview(path)
      const blobUrl = URL.createObjectURL(new Blob([preview.buffer], { type: preview.mimeType }))
      try {
        const image = await load(blobUrl)
        this.ownedObjectUrls.add(blobUrl)
        return { source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, ownedUrl: blobUrl }
      } catch (error) {
        URL.revokeObjectURL(blobUrl)
        throw error
      }
    }
  }

  private async imageResource(path: string): Promise<GpuImageResource> {
    const cached = this.images.get(path)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const source = await this.loadImage(path)
    const [width, height] = calcRenderSize(source.width || 1, source.height || 1, this.options.maxSide)
    const texture = createTexture(
      device,
      width,
      height,
      'rgba8unorm-srgb',
      TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
    )
    if (this.options.rasterizeImages) {
      // Headless Chromium can accept an external image upload without an
      // error but produce an empty texture. The standalone harness opts into
      // a deterministic RGBA upload for that backend-specific limitation.
      const rasterCanvas = document.createElement('canvas')
      rasterCanvas.width = width
      rasterCanvas.height = height
      const rasterContext = rasterCanvas.getContext('2d', { willReadFrequently: true })
      if (!rasterContext) throw new Error('无法准备 WebGPU 图片纹理')
      rasterContext.drawImage(source.source, 0, 0, width, height)
      const pixels = rasterContext.getImageData(0, 0, width, height).data
      writeTexture(device, texture, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    } else {
      device.queue.copyExternalImageToTexture({ source: source.source }, { texture }, { width, height })
    }
    if (this.options.waitForGpu) await device.queue.onSubmittedWorkDone?.()
    const resource = { texture, width, height, external: source }
    this.images.set(path, resource)
    this.scheduleRender()
    return resource
  }

  private async videoResource(layer: PreviewLayer, entry: GpuVideoEntry): Promise<GpuImageResource> {
    const device = this.device
    if (!device || !entry.ready) throw new Error('视频尚未准备好')
    const layerMaxSide = computeLayerDecodeMaxSide(layer, this.options.canvasWidth, this.options.canvasHeight, 1.5, this.options.maxSide)
    const [width, height] = calcRenderSize(entry.video.videoWidth || 1280, entry.video.videoHeight || 720, layerMaxSide)
    if (!entry.resource || entry.resource.width !== width || entry.resource.height !== height) {
      entry.resource?.texture.destroy?.()
      entry.resource = {
        // Chromium's video upload path uses an internal render pass on some
        // backends, so the destination must also allow render attachment use.
        texture: createTexture(
          device,
          width,
          height,
          'rgba8unorm-srgb',
          TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
        ),
        width,
        height,
        external: { source: entry.video, width: entry.video.videoWidth || width, height: entry.video.videoHeight || height },
      }
    }
    if (entry.lastUploadedFrame !== this.frameCounter) {
      device.queue.copyExternalImageToTexture(
        { source: entry.video },
        { texture: entry.resource.texture },
        { width, height },
      )
      entry.lastUploadedFrame = this.frameCounter
    }
    return entry.resource
  }

  private async maskResource(layer: PreviewLayer, path: string): Promise<GpuMaskResource> {
    const key = `${layer.maskProjectId ?? ''}:${path}`
    const cached = this.masks.get(key)
    if (cached) return cached
    const device = this.device
    if (!device || !layer.maskProjectId) throw new Error('蒙版所属项目不可用')
    const mask = await window.luna.workspace.loadColorMask(layer.maskProjectId, path)
    const source = new Uint8Array(mask.bytes)
    const rgba = encodeWebGpuColorMask(source, mask.width, mask.height)
    const texture = createTexture(device, mask.width, mask.height, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, texture, rgba, mask.width, mask.height)
    const resource = { texture, width: mask.width, height: mask.height }
    this.masks.set(key, resource)
    this.scheduleRender()
    return resource
  }

  private async lutResource(path: string): Promise<GpuLutResource> {
    const cached = this.luts.get(path)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    try {
      const data = await window.luna.workspace.loadLut(path)
      const parsed = parseWebGpuCube(new TextDecoder().decode(data))
      const texture = createTexture(device, parsed.size, parsed.size, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING, parsed.size)
      writeTexture(device, texture, parsed.rgba, parsed.size, parsed.size, parsed.size)
      const resource = { texture, size: parsed.size }
      this.luts.set(path, resource)
      this.scheduleRender()
      return resource
    } catch {
      throw new Error('调色文件无法在 WebGPU 预览中打开')
    }
  }

  private async fontFamilyFor(layer: PreviewLayer): Promise<string> {
    const namedFallback = layer.fontFamily?.trim()
    const fallback = namedFallback ? `${namedFallback}, sans-serif` : 'sans-serif'
    const fontFile = layer.fontFile?.trim()
    if (!fontFile) return fallback
    const family = webGpuFontFamily(fontFile)
    let pending = this.fontFamilies.get(fontFile)
    if (!pending) {
      pending = (async () => {
        const bytes = await window.luna.workspace.loadFont(fontFile)
        const face = new FontFace(family, bytes, { style: 'normal', weight: '400' })
        await face.load()
        document.fonts.add(face)
        return family
      })().catch((error: unknown) => {
        this.fontFamilies.delete(fontFile)
        throw error
      })
      this.fontFamilies.set(fontFile, pending)
    }
    try {
      return await pending
    } catch (error) {
      console.warn('[WebGpuVideoRenderer] font load fallback', { fontFile, error })
      return fallback
    }
  }

  private async textResource(layer: PreviewLayer, canvasWidth: number, canvasHeight: number): Promise<GpuImageResource> {
    const key = JSON.stringify([
      layer.fontFile ?? '', layer.fontFamily ?? '', layer.fontWeight ?? 400, layer.fontSize ?? 16,
      layer.textColor ?? '', layer.textAlign ?? 'left', layer.verticalAlign ?? 'middle', layer.content ?? '',
      canvasWidth, canvasHeight, layer.dstW, layer.dstH,
    ])
    const cached = this.textTextures.get(key)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const family = await this.fontFamilyFor(layer)
    const raster = rasterizeWebGpuText(layer, canvasWidth, canvasHeight, family)
    const texture = createTexture(device, raster.width, raster.height, 'rgba8unorm-srgb', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, texture, raster.rgba, raster.width, raster.height)
    if (this.options.waitForGpu) await device.queue.onSubmittedWorkDone?.()
    const resource = { texture, width: raster.width, height: raster.height }
    this.textTextures.set(key, resource)
    this.scheduleRender()
    return resource
  }

  private async resourceForLayer(
    layer: PreviewLayer,
    overrides: Map<string, GpuImageResource>,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<GpuImageResource> {
    if (layer.precomposeRole === 'output' && layer.precomposeGroup) {
      const resource = overrides.get(layer.precomposeGroup)
      if (!resource) throw new Error('预览合成层未准备好')
      return resource
    }
    if (layer.layerType === 'shape') {
      if (!this.identitySource) throw new Error('WebGPU 默认纹理未初始化')
      return this.identitySource
    }
    if (layer.layerType === 'text' || layer.layerType === 'logo') return this.textResource(layer, canvasWidth, canvasHeight)
    if (layer.isVideo) {
      const entry = this.videos.get(videoLayerKey(layer))
      if (!entry?.ready) throw new Error('视频尚未准备好')
      return this.videoResource(layer, entry)
    }
    return this.imageResource(layer.filePath)
  }

  private async layerResources(
    layer: PreviewLayer,
    time: number,
    overrides: Map<string, GpuImageResource>,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<{
    source: GpuImageResource
    mask: GpuMaskResource
    lut: GpuLutResource
    restoreLut: GpuLutResource
    maskPresent: boolean
    maskTransform: { translateX: number; translateY: number; scale: number; rotation: number } | undefined
  }> {
    const source = await this.resourceForLayer(layer, overrides, canvasWidth, canvasHeight)
    const maskTime = Math.max(0, numberOr(layer.videoTime, 0) + time - numberOr(layer.videoOffset, 0))
    const timelineSample = maskTimelineSampleAt(layer.maskTimeline, maskTime)
    if (layer.maskTimeline && !timelineSample?.path) throw new Error('动态蒙版当前帧尚未准备好')
    const resolvedMaskPath = timelineSample?.path ?? layer.maskPath
    const mask = resolvedMaskPath && layer.maskProjectId
      ? await this.maskResource(layer, resolvedMaskPath)
      : this.identityMask
    if (!mask) throw new Error('WebGPU 默认蒙版未初始化')
    const lut = layer.lutId ? await this.lutResource(layer.lutId) : this.identityLut
    const restoreLut = layer.restoreLutId ? await this.lutResource(layer.restoreLutId) : this.identityLut
    if (!lut || !restoreLut) throw new Error('WebGPU 默认调色文件未初始化')
    const maskTransform = timelineSample?.transform ?? (layer.maskTrack
      ? maskTrackTransformAt(layer.maskTrack, maskTime)
      : undefined)
    return {
      source,
      mask,
      lut,
      restoreLut,
      maskPresent: Boolean(resolvedMaskPath && layer.maskProjectId),
      maskTransform,
    }
  }

  private bufferForLayer(index: number): GpuBuffer {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const cached = this.paramsBuffers.get(index)
    if (cached) return cached
    const buffer = device.createBuffer({ size: PARAM_FLOAT_COUNT * 4, usage: BUFFER_USAGE_UNIFORM | 0x08 })
    this.paramsBuffers.set(index, buffer)
    return buffer
  }

  private async drawLayers(
    layers: PreviewLayer[],
    targetView: GpuTextureView,
    canvasWidth: number,
    canvasHeight: number,
    time: number,
    overrides: Map<string, GpuImageResource>,
  ): Promise<void> {
    const device = this.device
    const sampler = this.sampler
    const layout = this.bindGroupLayout
    if (!device || !sampler || !layout) throw new Error('WebGPU 绘制对象未初始化')
    const encoder = device.createCommandEncoder({ label: 'luna-webgpu-preview' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    const sortedLayers = [...layers]
      .filter((layer) => (layer.activeStart == null || time >= layer.activeStart) && (layer.activeEnd == null || time < layer.activeEnd))
      .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
    for (let index = 0; index < sortedLayers.length; index += 1) {
      const layer = sortedLayers[index]
      if (layer.isVideo && !this.videos.get(videoLayerKey(layer))?.ready) continue
      let resources
      try {
        resources = await this.layerResources(layer, time, overrides, canvasWidth, canvasHeight)
      } catch (error) {
        // Bundled/custom watermarks are optional in the native path as well.
        if (layer.positioning) continue
        throw error
      }
      const positioning = positioningFor(layer.positioning, canvasWidth, canvasHeight)
      const sourceTransform: RenderLayerTransform = layer.transform ?? {
        crop: null,
        orientation: 0,
        rotate: 0,
        flipH: false,
        flipV: false,
        scale: 1,
        translateX: 0,
        translateY: 0,
      }
      let plannedTransform = planCoverTransform(
        layer,
        sourceTransform,
        resources.source.width,
        resources.source.height,
        canvasWidth,
        canvasHeight,
        positioning,
      )
      const fallbackRect: [number, number, number, number] = [
        numberOr(layer.dstX, 0), numberOr(layer.dstY, 0), numberOr(layer.dstW, 1), numberOr(layer.dstH, 1),
      ]
      const resolvedRect = resolvePositioning(
        positioning,
        fallbackRect,
        canvasWidth,
        canvasHeight,
        resources.source.width,
        resources.source.height,
      )
      let frame: [number, number] | undefined
      if (layer.fit === 'cover-scale') {
        const targetAspect = Math.max(0.001, (resolvedRect[2] * canvasWidth) / Math.max(1, resolvedRect[3] * canvasHeight))
        const scaled = planCoverScale(plannedTransform, resources.source.width, resources.source.height, targetAspect)
        plannedTransform = scaled.transform
        frame = scaled.frame
      }
      const revealProgress = layer.reveal ? compositionRevealProgress(layer.reveal, time) : 1
      const params = createLayerParams(
        layer,
        resources.source.width,
        resources.source.height,
        canvasWidth,
        canvasHeight,
        resources.maskPresent,
        resources.maskTransform,
        revealProgress,
        plannedTransform,
        resolvedRect,
        frame,
        resources.restoreLut.size,
        resources.lut.size,
      )
      const paramsBuffer = this.bufferForLayer(index)
      device.queue.writeBuffer(paramsBuffer, 0, params)
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: resources.source.texture.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: paramsBuffer } },
          { binding: 3, resource: resources.lut.texture.createView({ dimension: '3d' }) },
          { binding: 4, resource: sampler },
          { binding: 5, resource: resources.mask.texture.createView() },
          { binding: 6, resource: resources.restoreLut.texture.createView({ dimension: '3d' }) },
        ],
      })
      pass.setPipeline(this.pipelineFor(layer.blendMode))
      pass.setBindGroup(0, bindGroup)
      pass.draw(4, 1, 0, 0)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
    if (this.options.waitForGpu) await device.queue.onSubmittedWorkDone?.()
  }

  private outputResource(width: number, height: number): GpuImageResource {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    if (this.outputTexture?.width === width && this.outputTexture.height === height) return this.outputTexture
    this.outputTexture?.texture.destroy?.()
    const texture = createTexture(
      device,
      width,
      height,
      this.canvasFormat,
      TEXTURE_USAGE_COPY_SRC | TEXTURE_USAGE_RENDER_ATTACHMENT,
    )
    this.outputTexture = { texture, width, height }
    return this.outputTexture
  }

  private async render(): Promise<void> {
    if (this.destroyed || !this.initialized || !this.context || !this.active) return
    const context = this.context
    const device = this.device
    if (!device) return
    if (this.renderInFlight) {
      this.renderQueued = true
      return
    }
    this.renderInFlight = true
    this.renderQueued = false
    this.frameCounter += 1
    const revision = this.renderRevision
    const currentLayers = this.layers
    try {
      this.syncVideoClocks()
      const groups = new Map<string, PreviewLayer[]>()
      for (const layer of currentLayers) {
        if (layer.precomposeRole !== 'input' || !layer.precomposeGroup) continue
        const group = groups.get(layer.precomposeGroup) ?? []
        group.push(layer)
        groups.set(layer.precomposeGroup, group)
      }
      const overrides = new Map<string, GpuImageResource>()
      const skippedGroups = new Set<string>()
      for (const [group, groupLayers] of groups) {
        if (groupLayers.some((layer) => layer.isVideo && !this.videos.get(videoLayerKey(layer))?.ready)) {
          skippedGroups.add(group)
          continue
        }
        const first = await this.resourceForLayer(groupLayers[0], new Map(), this.options.canvasWidth, this.options.canvasHeight)
        let target = this.precompositions.get(group)
        if (!target || target.width !== first.width || target.height !== first.height) {
          target?.texture.destroy?.()
          const texture = createTexture(
            this.device!,
            first.width,
            first.height,
            this.canvasFormat,
            TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
          )
          target = { texture, width: first.width, height: first.height }
          this.precompositions.set(group, target)
        }
        await this.drawLayers(groupLayers, target.texture.createView(), target.width, target.height, this.compositionTime, new Map())
        overrides.set(group, target)
      }
      if (revision !== this.renderRevision || this.destroyed) return
      const outputLayers = currentLayers.filter((layer) => (
        layer.precomposeRole !== 'input'
        && !(layer.precomposeRole === 'output' && layer.precomposeGroup && skippedGroups.has(layer.precomposeGroup))
      ))
      const output = this.outputResource(this.options.canvasWidth, this.options.canvasHeight)
      await this.drawLayers(outputLayers, output.texture.createView(), output.width, output.height, this.compositionTime, overrides)
      const presentationTexture = context.getCurrentTexture()
      const copyEncoder = device.createCommandEncoder({ label: 'luna-webgpu-present' })
      copyEncoder.copyTextureToTexture(
        { texture: output.texture },
        { texture: presentationTexture },
        { width: output.width, height: output.height, depthOrArrayLayers: 1 },
      )
      device.queue.submit([copyEncoder.finish()])
      if (this.options.waitForGpu) await device.queue.onSubmittedWorkDone?.()
      if (!this.destroyed) this.options.onRender()
    } catch (error: unknown) {
      if (!this.destroyed) this.fail(error instanceof Error ? error.message : String(error))
    } finally {
      this.renderInFlight = false
      if (this.renderQueued && !this.destroyed) {
        this.renderQueued = false
        this.scheduleRender()
      }
    }
  }

  async readOutputFrame(): Promise<Uint8Array> {
    const device = this.device
    const output = this.outputTexture
    if (!device || !output) throw new Error('WebGPU 输出画面尚未准备好')
    const bytesPerRow = Math.ceil(output.width * 4 / 256) * 256
    const buffer = device.createBuffer({ size: bytesPerRow * output.height, usage: 0x01 | 0x08 })
    try {
      const encoder = device.createCommandEncoder({ label: 'luna-webgpu-readback' })
      encoder.copyTextureToBuffer(
        { texture: output.texture },
        { buffer, bytesPerRow, rowsPerImage: output.height },
        { width: output.width, height: output.height, depthOrArrayLayers: 1 },
      )
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone?.()
      await buffer.mapAsync(0x01)
      const mapped = new Uint8Array(buffer.getMappedRange())
      const rgba = new Uint8Array(output.width * output.height * 4)
      const isBgra = this.canvasFormat.startsWith('bgra')
      for (let y = 0; y < output.height; y += 1) {
        const sourceOffset = y * bytesPerRow
        const targetOffset = y * output.width * 4
        for (let x = 0; x < output.width; x += 1) {
          const sourcePixel = sourceOffset + x * 4
          const targetPixel = targetOffset + x * 4
          rgba[targetPixel] = mapped[sourcePixel + (isBgra ? 2 : 0)] ?? 0
          rgba[targetPixel + 1] = mapped[sourcePixel + 1] ?? 0
          rgba[targetPixel + 2] = mapped[sourcePixel + (isBgra ? 0 : 2)] ?? 0
          rgba[targetPixel + 3] = mapped[sourcePixel + 3] ?? 255
        }
      }
      buffer.unmap()
      return rgba
    } finally {
      buffer.destroy?.()
    }
  }
}

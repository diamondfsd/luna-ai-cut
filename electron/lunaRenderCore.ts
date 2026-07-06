/**
 * Luna Render Core — Native (Rust/wgpu) 封装
 *
 * 在 Electron 主进程中加载 .node addon，
 * 为 IPC 层提供类型安全的调用接口。
 * 可选字段在此层填充默认值后传入 Rust。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// ── 对外暴露的接口（可选字段由本层补默认值） ──

export interface PreviewLayerInputForExport {
  filePath: string
  isVideo?: boolean
  videoTime?: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: Partial<RenderColorAdjustments>
  transform?: Partial<RenderLayerTransform>
}

export interface RenderCoreLayerInput {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: Partial<RenderColorAdjustments>
  transform?: Partial<RenderLayerTransform>
}

/** render_preview 的单个层 */
export interface PreviewLayerInput {
  filePath: string
  isVideo: boolean
  videoTime: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
  color: RenderColorAdjustments
  transform: RenderLayerTransform
}

/** render_preview 输入 */
export interface RenderPreviewInput {
  ffmpegPath: string
  ffprobePath: string
  width?: number
  height?: number
  maxSide?: number
  layers: PreviewLayerInputForExport[]
}

export interface RenderPreviewOutput {
  width: number
  height: number
  data: Buffer
}

export interface PreviewTextureInput {
  textureId: number
  width: number
  height: number
}

export interface PreviewPlanInput {
  width?: number
  height?: number
  maxSide?: number
  layers: Array<{ layer: PreviewLayerInputForExport; texture: PreviewTextureInput }>
}

export interface PreviewPlanOutput {
  width: number
  height: number
  layers: RenderCoreLayerInput[]
}

// ── Native 内部全字段类型 ──

interface PreviewNativeLayer {
  filePath: string
  isVideo: boolean
  videoTime: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
  color: RenderColorAdjustments
  transform: RenderLayerTransform
}

interface NativeLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
  color: RenderColorAdjustments
  transform: RenderLayerTransform
}

interface RenderColorAdjustments {
  exposure: number
  black: number
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  clarity: number
  texture: number
  sharpen: number
  denoise: number
  gradeShadowsHue: number
  gradeShadowsAmount: number
  gradeMidHue: number
  gradeMidAmount: number
  gradeHighlightsHue: number
  gradeHighlightsAmount: number
  curveLift: number
  curveContrast: number
  curve: {
    rgb: Array<{ x: number; y: number }>
    luminance: Array<{ x: number; y: number }>
    red: Array<{ x: number; y: number }>
    green: Array<{ x: number; y: number }>
    blue: Array<{ x: number; y: number }>
  }
  levelsBlack: number
  levelsGray: number
  levelsWhite: number
  hslChannels: Array<{
    hue: number
    hueShift: number
    saturation: number
    luminance: number
  }>
}

interface RenderCropRect {
  x: number
  y: number
  w: number
  h: number
}

interface RenderLayerTransform {
  crop?: RenderCropRect
  orientation: number
  rotate: number
  flipH: boolean
  flipV: boolean
  scale: number
}

interface LunaRenderCoreNative {
  initCompositor(logPath?: string): void
  loadTexture(data: Buffer, width: number, height: number): number
  loadTextureFromPath(ffmpegPath: string, ffprobePath: string, path: string, maxSize: number): { textureId?: number; texture_id?: number; width: number; height: number }
  updateTexture(textureId: number, data: Buffer): void
  releaseTexture(textureId: number): void
  renderFrame(canvasWidth: number, canvasHeight: number, layers: NativeLayer[]): Buffer
  renderPreview(input: any): RenderPreviewOutput
  planPreview(input: any): { width: number; height: number; layers: NativeLayer[] }
  resolveRenderSource(
    ffmpegPath: string,
    ffprobePath: string,
    originalPath: string,
    cacheDir: string,
  ): { renderPath: string; normalized: boolean; width: number; height: number }
  exportImageFromSourcesAsync(
    ffmpegPath: string,
    ffprobePath: string,
    outputPath: string,
    width: number,
    height: number,
    layers: PreviewNativeLayer[],
    format: string,
    quality: number,
  ): Promise<void>
  exportFileAsync(
    ffmpegPath: string, ffprobePath: string,
    inputPath: string, outputPath: string,
    canvasWidth: number, canvasHeight: number,
    fps: number | null, hardware: boolean,
    layers: PreviewNativeLayer[],
    taskId: string | null, qualityPreset: string | null,
  ): Promise<void>
  cancelExportTask(taskId: string): void
  getExportTaskProgress(taskId: string): [number, number] | null
  destroyCompositor(): void
}

/** 补全可选字段的默认值 */
function normalizePreviewLayer(l: PreviewLayerInputForExport): PreviewNativeLayer {
  return {
    filePath: l.filePath,
    isVideo: l.isVideo ?? false,
    videoTime: l.videoTime ?? 0,
    dstX: l.dstX, dstY: l.dstY, dstW: l.dstW, dstH: l.dstH,
    srcX: l.srcX ?? 0, srcY: l.srcY ?? 0,
    srcW: l.srcW ?? 1, srcH: l.srcH ?? 1,
    opacity: l.opacity ?? 1,
    zIndex: l.zIndex ?? 0,
    color: normalizeColor(l.color),
    transform: normalizeTransform(l.transform),
  }
}

function normalizeLayer(l: RenderCoreLayerInput): NativeLayer {
  return {
    textureId: l.textureId,
    dstX: l.dstX, dstY: l.dstY, dstW: l.dstW, dstH: l.dstH,
    srcX: l.srcX ?? 0, srcY: l.srcY ?? 0,
    srcW: l.srcW ?? 1, srcH: l.srcH ?? 1,
    opacity: l.opacity ?? 1,
    zIndex: l.zIndex ?? 0,
    color: normalizeColor(l.color),
    transform: normalizeTransform(l.transform),
  }
}

function normalizeColor(color?: Partial<RenderColorAdjustments>): RenderColorAdjustments {
  const curve = color?.curve
  return {
    exposure: color?.exposure ?? 0,
    black: color?.black ?? 0,
    brightness: color?.brightness ?? 0,
    contrast: color?.contrast ?? 0,
    saturation: color?.saturation ?? 0,
    vibrance: color?.vibrance ?? 0,
    temperature: color?.temperature ?? 0,
    tint: color?.tint ?? 0,
    highlights: color?.highlights ?? 0,
    shadows: color?.shadows ?? 0,
    whites: color?.whites ?? 0,
    blacks: color?.blacks ?? 0,
    clarity: color?.clarity ?? 0,
    texture: color?.texture ?? 0,
    sharpen: color?.sharpen ?? 0,
    denoise: color?.denoise ?? 0,
    gradeShadowsHue: color?.gradeShadowsHue ?? 220,
    gradeShadowsAmount: color?.gradeShadowsAmount ?? 0,
    gradeMidHue: color?.gradeMidHue ?? 35,
    gradeMidAmount: color?.gradeMidAmount ?? 0,
    gradeHighlightsHue: color?.gradeHighlightsHue ?? 42,
    gradeHighlightsAmount: color?.gradeHighlightsAmount ?? 0,
    curveLift: color?.curveLift ?? 0,
    curveContrast: color?.curveContrast ?? 0,
    curve: {
      rgb: normalizeCurvePoints(curve?.rgb),
      luminance: normalizeCurvePoints(curve?.luminance),
      red: normalizeCurvePoints(curve?.red),
      green: normalizeCurvePoints(curve?.green),
      blue: normalizeCurvePoints(curve?.blue),
    },
    levelsBlack: color?.levelsBlack ?? 0,
    levelsGray: color?.levelsGray ?? 0.5,
    levelsWhite: color?.levelsWhite ?? 1,
    hslChannels: normalizeHslChannels(color?.hslChannels),
  }
}

const DEFAULT_HSL_CHANNELS = [0, 30, 60, 120, 180, 240, 285, 320]

function normalizeHslChannels(channels?: Array<{ hue?: number; hueShift?: number; saturation?: number; luminance?: number }>): RenderColorAdjustments['hslChannels'] {
  return DEFAULT_HSL_CHANNELS.map((defaultHue, index) => {
    const channel = Array.isArray(channels) ? channels[index] : undefined
    return {
      hue: clampNumber(channel?.hue ?? defaultHue, 0, 360),
      hueShift: clampNumber(channel?.hueShift ?? 0, -180, 180),
      saturation: clampNumber(channel?.saturation ?? 0, -100, 100),
      luminance: clampNumber(channel?.luminance ?? 0, -100, 100),
    }
  })
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min <= 0 && max >= 0 ? 0 : min
  return Math.min(max, Math.max(min, value))
}

function normalizeCurvePoints(points?: Array<{ x?: number; y?: number }>): Array<{ x: number; y: number }> {
  if (!Array.isArray(points)) return []
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: clamp01(point.x ?? 0),
      y: clamp01(point.y ?? 0),
    }))
    .sort((a, b) => a.x - b.x)
    .slice(0, 12)
}

function normalizeDegrees(value: number): number {
  const rounded = Math.round(value / 90) * 90
  return ((rounded % 360) + 360) % 360
}

function normalizeCrop(crop?: Partial<RenderCropRect> | null): RenderCropRect | undefined {
  if (!crop) return undefined
  const x = clamp01(crop.x ?? 0)
  const y = clamp01(crop.y ?? 0)
  const w = Math.max(0.001, Math.min(1 - x, crop.w ?? 1))
  const h = Math.max(0.001, Math.min(1 - y, crop.h ?? 1))
  return { x, y, w, h }
}

function normalizeTransform(transform?: Partial<RenderLayerTransform>): RenderLayerTransform {
  const crop = normalizeCrop(transform?.crop)
  return {
    ...(crop ? { crop } : {}),
    orientation: normalizeDegrees(transform?.orientation ?? 0),
    rotate: transform?.rotate ?? 0,
    flipH: Boolean(transform?.flipH),
    flipV: Boolean(transform?.flipV),
    scale: Math.max(0.01, transform?.scale ?? 1),
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

let native: LunaRenderCoreNative | null = null

function getNative(): LunaRenderCoreNative {
  if (native) return native

  const appRoot = process.env.APP_ROOT || join(import.meta.dirname, '..')
  const nodePath = join(appRoot, 'luna-render-core', 'luna-render-core.node')
  try {
    native = require(nodePath) as LunaRenderCoreNative
    return native!
  } catch (err) {
    throw new Error(`Failed to load native render core from ${nodePath}: ${err}`)
  }
}

let initialized = false

export function ensureInit(logPath?: string): void {
  if (!initialized) {
    getNative().initCompositor(logPath ?? undefined)
    initialized = true
  }
}

export function loadTexture(data: Buffer, width: number, height: number): number {
  ensureInit()
  return getNative().loadTexture(data, width, height)
}

export function loadTextureFromPath(
  ffmpegPath: string,
  ffprobePath: string,
  path: string,
  maxSize: number,
): { textureId: number; width: number; height: number } {
  ensureInit()
  const filePath = path.startsWith('file://') ? fileURLToPath(path) : path
  const result = getNative().loadTextureFromPath(ffmpegPath, ffprobePath, filePath, maxSize)
  const textureId = result.textureId ?? result.texture_id
  if (textureId == null) throw new Error('Native render core did not return a texture id')
  return { textureId, width: result.width, height: result.height }
}

export function updateTexture(textureId: number, data: Buffer): void {
  getNative().updateTexture(textureId, data)
}

export function releaseTexture(textureId: number): void {
  getNative().releaseTexture(textureId)
}

export function renderFrame(
  canvasWidth: number,
  canvasHeight: number,
  layers: RenderCoreLayerInput[],
): Buffer {
  return getNative().renderFrame(canvasWidth, canvasHeight, layers.map(normalizeLayer))
}

export interface ResolvedRenderSource {
  renderPath: string
  normalized: boolean
  width: number
  height: number
}

export function resolveRenderSource(
  ffmpegPath: string,
  ffprobePath: string,
  originalPath: string,
  cacheDir: string,
): ResolvedRenderSource {
  ensureInit()
  return getNative().resolveRenderSource(ffmpegPath, ffprobePath, originalPath, cacheDir)
}

export function exportImageFromSourcesAsync(
  ffmpegPath: string,
  ffprobePath: string,
  outputPath: string,
  width: number,
  height: number,
  layers: PreviewLayerInputForExport[],
  format: string,
  quality: number,
): Promise<void> {
  ensureInit()
  return getNative().exportImageFromSourcesAsync(ffmpegPath, ffprobePath, outputPath, width, height, layers.map(normalizePreviewLayer), format, quality)
}

export function renderPreview(input: RenderPreviewInput): RenderPreviewOutput {
  ensureInit()
  return getNative().renderPreview({
    ...input,
    layers: input.layers.map(normalizePreviewLayer),
  })
}

export function planPreview(input: PreviewPlanInput): PreviewPlanOutput {
  ensureInit()
  return getNative().planPreview({
    width: input.width,
    height: input.height,
    maxSide: input.maxSide,
    layers: input.layers.map((item) => ({
      layer: normalizePreviewLayer(item.layer),
      texture: {
        textureId: item.texture.textureId,
        width: item.texture.width,
        height: item.texture.height,
      },
    })),
  })
}

export function exportFileAsync(
  ffmpegPath: string,
  ffprobePath: string,
  inputPath: string,
  outputPath: string,
  canvasWidth: number,
  canvasHeight: number,
  fps: number | null,
  hardware: boolean,
  layers: PreviewLayerInputForExport[],
  taskId?: string,
  qualityPreset?: string,
): Promise<void> {
  ensureInit()
  return getNative().exportFileAsync(
    ffmpegPath,
    ffprobePath,
    inputPath,
    outputPath,
    canvasWidth,
    canvasHeight,
    fps,
    hardware,
    layers.map(normalizePreviewLayer),
    taskId ?? null,
    qualityPreset ?? null,
  )
}

export function cancelExportTask(taskId: string): void {
  getNative().cancelExportTask(taskId)
}

export function getExportTaskProgress(taskId: string): [number, number] | null {
  const result = getNative().getExportTaskProgress(taskId)
  if (!result) return null
  return [result[0], result[1]]
}

export function destroy(): void {
  if (initialized) {
    getNative().destroyCompositor()
    initialized = false
  }
}

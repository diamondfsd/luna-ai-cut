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

export interface RenderCoreLayerInput {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

/** render_preview 的单个层 */
export interface PreviewLayerInput {
  filePath: string
  isVideo: boolean
  videoTime: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
}

/** render_preview 输入 */
export interface RenderPreviewInput {
  ffmpegPath: string
  ffprobePath: string
  width: number
  height: number
  layers: PreviewLayerInput[]
}

// ── Native 内部全字段类型 ──

interface NativeLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
}

interface LunaRenderCoreNative {
  initCompositor(logPath?: string): void
  loadTexture(data: Buffer, width: number, height: number): number
  loadTextureFromPath(ffmpegPath: string, ffprobePath: string, path: string, maxSize: number): { textureId?: number; texture_id?: number; width: number; height: number }
  updateTexture(textureId: number, data: Buffer): void
  releaseTexture(textureId: number): void
  renderFrame(canvasWidth: number, canvasHeight: number, layers: NativeLayer[]): Buffer
  renderPreview(input: any): Buffer
  exportImageFromSources(
    ffmpegPath: string,
    ffprobePath: string,
    outputPath: string,
    width: number,
    height: number,
    layers: NativeLayer[],
    format: string,
    quality: number,
  ): void
  renderLayersToFile(
    ffmpegPath: string,
    outputPath: string,
    width: number,
    height: number,
    layers: NativeLayer[],
    format: string,
    quality: number,
  ): void
  exportFile(
    ffmpegPath: string, ffprobePath: string,
    inputPath: string, outputPath: string,
    canvasWidth: number, canvasHeight: number,
    fps: number | null, hardware: boolean,
    videoLayer: NativeLayer, staticLayers: NativeLayer[],
    taskId: string | null, qualityPreset: string | null,
  ): void
  cancelExportTask(taskId: string): void
  getExportTaskProgress(taskId: string): [number, number] | null
  destroyCompositor(): void
}

/** 补全可选字段的默认值 */
function normalizeLayer(l: RenderCoreLayerInput): NativeLayer {
  return {
    textureId: l.textureId,
    dstX: l.dstX, dstY: l.dstY, dstW: l.dstW, dstH: l.dstH,
    srcX: l.srcX ?? 0, srcY: l.srcY ?? 0,
    srcW: l.srcW ?? 1, srcH: l.srcH ?? 1,
    opacity: l.opacity ?? 1,
    zIndex: l.zIndex ?? 0,
  }
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

export function exportImageFromSources(
  ffmpegPath: string,
  ffprobePath: string,
  outputPath: string,
  width: number,
  height: number,
  layers: RenderCoreLayerInput[],
  format: string,
  quality: number,
): void {
  ensureInit()
  getNative().exportImageFromSources(ffmpegPath, ffprobePath, outputPath, width, height, layers.map(normalizeLayer), format, quality)
}

export function renderLayersToFile(
  ffmpegPath: string,
  outputPath: string,
  width: number,
  height: number,
  layers: RenderCoreLayerInput[],
  format: string,
  quality: number,
): void {
  ensureInit()
  getNative().renderLayersToFile(ffmpegPath, outputPath, width, height, layers.map(normalizeLayer), format, quality)
}

export function renderPreview(input: RenderPreviewInput): Buffer {
  ensureInit()
  return getNative().renderPreview(input)
}

export function exportFile(
  ffmpegPath: string,
  ffprobePath: string,
  inputPath: string,
  outputPath: string,
  canvasWidth: number,
  canvasHeight: number,
  fps: number | null,
  hardware: boolean,
  videoLayer: RenderCoreLayerInput,
  staticLayers: RenderCoreLayerInput[],
  taskId?: string,
  qualityPreset?: string,
): void {
  ensureInit()
  getNative().exportFile(ffmpegPath, ffprobePath, inputPath, outputPath, canvasWidth, canvasHeight, fps, hardware, normalizeLayer(videoLayer), staticLayers.map(normalizeLayer), taskId ?? null, qualityPreset ?? null)
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

/**
 * Luna Render Core — Native (Rust/wgpu) 封装
 *
 * 在 Electron 主进程中加载 .node addon，
 * 为 IPC 层提供类型安全的调用接口。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
}

interface LunaRenderCoreNative {
  initCompositor(logPath?: string): void
  loadTexture(data: Buffer, width: number, height: number): number
  updateTexture(textureId: number, data: Buffer): void
  releaseTexture(textureId: number): void
  renderFrame(canvasWidth: number, canvasHeight: number, layers: RenderLayer[]): Buffer
  exportFile(
    ffmpegPath: string, ffprobePath: string,
    inputPath: string, outputPath: string,
    canvasWidth: number, canvasHeight: number,
    fps: number | null, hardware: boolean,
    videoLayer: RenderLayer, staticLayers: RenderLayer[],
  ): void
  destroyCompositor(): void
}

let native: LunaRenderCoreNative | null = null

function getNative(): LunaRenderCoreNative {
  if (native) return native

  // APP_ROOT 在 appMain.ts 中设为项目根目录
  const appRoot = process.env.APP_ROOT || join(import.meta.dirname, '..')
  const nodePath = join(appRoot, 'luna-render-core', 'luna-render-core.node')
  try {
    native = require(nodePath) as LunaRenderCoreNative
    return native!
  } catch (err) {
    throw new Error(`Failed to load native render core from ${nodePath}: ${err}`)
  }
}

// ── 公开接口 ──

export interface RenderCoreLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
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

export function updateTexture(textureId: number, data: Buffer): void {
  getNative().updateTexture(textureId, data)
}

export function releaseTexture(textureId: number): void {
  getNative().releaseTexture(textureId)
}

export function renderFrame(
  canvasWidth: number,
  canvasHeight: number,
  layers: RenderCoreLayer[],
): Buffer {
  return getNative().renderFrame(canvasWidth, canvasHeight, layers)
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
  videoLayer: RenderCoreLayer,
  staticLayers: RenderCoreLayer[],
): void {
  ensureInit()
  getNative().exportFile(ffmpegPath, ffprobePath, inputPath, outputPath, canvasWidth, canvasHeight, fps, hardware, videoLayer, staticLayers)
}

export function destroy(): void {
  if (initialized) {
    getNative().destroyCompositor()
    initialized = false
  }
}

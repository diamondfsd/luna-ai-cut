/**
 * Luna Render Core — Native (Rust/wgpu) 封装
 *
 * 在 Electron 主进程中加载 .node addon，
 * 为 IPC 层提供类型安全的调用接口。
 * 可选字段在此层填充默认值后传入 Rust。
 */
import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type LayerPositioningData,
  type RenderColorAdjustments,
  type RenderLayerTransform,
} from './lunaRenderCoreNormalize'

const require = createRequire(import.meta.url)

// ── 对外暴露的接口（可选字段由本层补默认值） ──

export interface CompositionInput {
  version?: number
  canvas: {
    width: number
    height: number
    fps?: number
    duration?: number
  }
  layers: Array<{
    id?: string
    source: {
      path: string
      sourceType?: 'auto' | 'image' | 'video' | string
      time?: {
        offset?: number
        start?: number
        duration?: number
        loopEnabled?: boolean
      }
    }
    rect: { x: number; y: number; w: number; h: number }
    fit?: 'cover' | 'contain' | string
    opacity?: number
    zIndex?: number
    color?: Partial<RenderColorAdjustments>
    maskPath?: string
    maskOpacity?: number
    maskInverted?: boolean
    maskFeather?: number
    transform?: Partial<RenderLayerTransform>
    positioning?: LayerPositioningData | { landscape?: LayerPositioningData; portrait?: LayerPositioningData }
  }>
}

export function cleanNativeInput<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cleanNativeInput(item)) as T
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue
    output[key] = cleanNativeInput(item)
  }
  return output as T
}

export interface ResolvedRenderSource {
  renderPath: string
  normalized: boolean
  width: number
  height: number
}

export interface RenderPreviewOutput {
  width: number
  height: number
  data: Buffer
}

interface LunaRenderCoreNative {
  initCompositor(logPath?: string): void
  loadTexture(data: Buffer, width: number, height: number): number
  updateTexture(textureId: number, data: Buffer): void
  renderFrame(canvasWidth: number, canvasHeight: number, layers: unknown[]): Buffer
  releaseTexture(textureId: number): void
  renderCompositionFrame(input: any): RenderPreviewOutput
  renderCompositionFrameAsync(input: any): Promise<RenderPreviewOutput>
  exportCompositionVideoAsync(input: any): Promise<void>
  resolveRenderSource(
    ffmpegPath: string,
    ffprobePath: string,
    originalPath: string,
    cacheDir: string,
  ): { renderPath: string; normalized: boolean; width: number; height: number }
  exportCompositionImageAsync(input: any): Promise<void>
  cancelExportTask(taskId: string): void
  getExportTaskProgress(taskId: string): [number, number] | null
  segmentImage(modelPath: string, rgb: Buffer, pointX: number, pointY: number): {
    width: number
    height: number
    classId: number
    bytes: Buffer
  }
}

let native: LunaRenderCoreNative | null = null

export function getNative(): LunaRenderCoreNative {
  if (native) return native

  // 遍历多个候选路径加载 .node addon：
  //   1. 打包后：process.resourcesPath/luna-render-core/luna-render-core.node
  //      （extraResources 将 luna-render-core 复制到 resources/）
  //   2. 开发时：APP_ROOT/luna-render-core/luna-render-core.node
  //      （build-native.mjs 复制到项目根目录 luna-render-core/）
  const candidates = [
    join(process.resourcesPath || '', 'luna-render-core', 'luna-render-core.node'),
    join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'luna-render-core', 'luna-render-core.node'),
  ]
  for (const nodePath of candidates) {
    try {
      native = require(nodePath) as LunaRenderCoreNative
      return native!
    } catch { /* try next candidate */ }
  }
  throw new Error(
    `Failed to load native render core. Tried:\n` +
      candidates.map((p) => `  - ${p}`).join('\n'),
  )
}

let initialized = false
const INIT_GUARD_FILE = '.lrc-init-running.json'
export const LRC_COMPATIBILITY_BLOCKED = 'LRC_COMPATIBILITY_BLOCKED'

function initGuardPath(): string {
  return join(app.getPath('userData'), INIT_GUARD_FILE)
}

function writeInitGuard(): void {
  writeFileSync(initGuardPath(), JSON.stringify({
    pid: process.pid,
    version: app.getVersion(),
    platform: process.platform,
    startedAt: new Date().toISOString(),
  }), 'utf8')
}

function clearInitGuard(): void {
  try {
    rmSync(initGuardPath(), { force: true })
  } catch {
    // 清理失败时保留保护状态，避免持续触发 native 崩溃。
  }
}

export function resetRenderCompatibilityBlock(): void {
  clearInitGuard()
}

export function ensureInit(logPath?: string): void {
  if (initialized) return
  if (existsSync(initGuardPath())) {
    throw new Error(`${LRC_COMPATIBILITY_BLOCKED}: previous native initialization did not complete`)
  }

  writeInitGuard()
  try {
    getNative().initCompositor(logPath ?? undefined)
    initialized = true
    clearInitGuard()
  } catch (error) {
    clearInitGuard()
    throw error
  }
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

export function renderCompositionFrame(
  ffmpegPath: string,
  ffprobePath: string,
  composition: CompositionInput,
  time: number,
  maxSide?: number,
): RenderPreviewOutput {
  ensureInit()
  return getNative().renderCompositionFrame(cleanNativeInput({ ffmpegPath, ffprobePath, composition, time, maxSide }))
}

export function renderCompositionFrameAsync(
  ffmpegPath: string,
  ffprobePath: string,
  composition: CompositionInput,
  time: number,
  maxSide?: number,
): Promise<RenderPreviewOutput> {
  ensureInit()
  return getNative().renderCompositionFrameAsync(cleanNativeInput({ ffmpegPath, ffprobePath, composition, time, maxSide }))
}

export function exportCompositionVideoAsync(input: {
  ffmpegPath: string
  ffprobePath: string
  outputPath: string
  composition: CompositionInput
  fps?: number | null
  duration?: number | null
  hardware?: boolean
  taskId?: string
  qualityPreset?: string
}): Promise<void> {
  ensureInit()
  return getNative().exportCompositionVideoAsync(cleanNativeInput({
    ffmpegPath: input.ffmpegPath,
    ffprobePath: input.ffprobePath,
    outputPath: input.outputPath,
    composition: input.composition,
    fps: input.fps ?? undefined,
    duration: input.duration ?? undefined,
    hardware: input.hardware,
    taskId: input.taskId,
    qualityPreset: input.qualityPreset,
  }))
}

export function cancelExportTask(taskId: string): void {
  getNative().cancelExportTask(taskId)
}

export function exportCompositionImageAsync(input: {
  ffmpegPath: string
  ffprobePath: string
  outputPath: string
  composition: CompositionInput
  format: string
  quality: number
}): Promise<void> {
  ensureInit()
  return getNative().exportCompositionImageAsync(cleanNativeInput({
    ffmpegPath: input.ffmpegPath,
    ffprobePath: input.ffprobePath,
    outputPath: input.outputPath,
    composition: input.composition,
    format: input.format,
    quality: input.quality,
  }))
}

export function getExportTaskProgress(taskId: string): [number, number] | null {
  const result = getNative().getExportTaskProgress(taskId)
  if (!result) return null
  return [result[0], result[1]]
}

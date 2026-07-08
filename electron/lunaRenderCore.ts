/**
 * Luna Render Core — Native (Rust/wgpu) 封装
 *
 * 在 Electron 主进程中加载 .node addon，
 * 为 IPC 层提供类型安全的调用接口。
 * 可选字段在此层填充默认值后传入 Rust。
 */
import { createRequire } from 'node:module'
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
    transform?: Partial<RenderLayerTransform>
    positioning?: LayerPositioningData | { landscape?: LayerPositioningData; portrait?: LayerPositioningData }
  }>
}

function cleanNativeInput<T>(value: T): T {
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
  renderCompositionFrame(input: any): RenderPreviewOutput
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


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
    layerType?: 'media' | 'local-color' | 'pixel-stretch' | 'pixel-flow' | 'shape' | 'text' | 'logo' | 'decoration'
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
    sourceRect?: { x: number; y: number; w: number; h: number }
    fit?: 'cover' | 'contain' | string
    opacity?: number
    blendMode?: 'normal' | 'multiply' | 'screen' | 'add'
    zIndex?: number
    color?: Partial<RenderColorAdjustments>
    maskPath?: string
    maskOpacity?: number
    maskInverted?: boolean
    maskFeather?: number
    pixelStretch?: {
      mode: 'left' | 'right' | 'up' | 'down' | 'horizontal' | 'vertical' | 'swirl' | 'swirl-front'
      intensity: number
      originX: number
      originY: number
      angle?: number
      ribbonSize?: number
      sampleStart?: number
      sampleEnd?: number
      lineEnd?: number
      controlStart?: number
      controlEnd?: number
      centerX?: number
      centerY?: number
      pathPoints?: number[]
      pathStartWidth?: number
      pathEndWidth?: number
      fillSampleGaps?: boolean
    }
    pixelFlow?: {
      duration: number
      progress?: number
      pixelCount: number
      lightWidth: number
      initialSaturation: number
      initialBrightness: number
      rainSpeed: number
      rainLength: number
      flowStrength: number
      subjectDelay: number
      bloomStrength: number
      filterStrength: number
      colorTransition: number
      segmented?: boolean
    }
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
  initCompositorAsync(logPath?: string): Promise<void>
  getNativePreviewCapabilities(): NativePreviewCapabilities
  createNativePreviewSession(input: unknown): Promise<number>
  updateNativePreviewComposition(sessionId: number, composition: unknown): void
  setNativePreviewBounds(sessionId: number, bounds: NativePreviewBounds): void
  setNativePreviewVisible(sessionId: number, visible: boolean): void
  playNativePreview(sessionId: number, time: number): void
  pauseNativePreview(sessionId: number, time: number): void
  seekNativePreview(sessionId: number, time: number): void
  getNativePreviewSessionStats(sessionId: number): NativePreviewSessionStats
  destroyNativePreviewSession(sessionId: number): void
  loadTexture(data: Buffer, width: number, height: number): number
  updateTexture(textureId: number, data: Buffer): void
  renderFrame(canvasWidth: number, canvasHeight: number, layers: unknown[]): Buffer
  releaseTexture(textureId: number): void
  renderCompositionFrame(input: unknown): RenderPreviewOutput
  renderCompositionFrameAsync(input: unknown): Promise<RenderPreviewOutput>
  exportCompositionVideoAsync(input: unknown): Promise<void>
  resolveRenderSource(
    ffmpegPath: string,
    ffprobePath: string,
    originalPath: string,
    cacheDir: string,
  ): { renderPath: string; normalized: boolean; width: number; height: number }
  exportCompositionImageAsync(input: unknown): Promise<void>
  cancelExportTask(taskId: string): void
  getExportTaskProgress(taskId: string): [number, number] | null
  segmentImage(modelPath: string, rgb: Buffer, pointX: number, pointY: number, targetClassId?: number, inputSize?: number): {
    width: number
    height: number
    classId: number
    bytes: Buffer
  }
  segmentSam(visionEncoderPath: string, promptDecoderPath: string, rgb: Buffer, sourceWidth: number, sourceHeight: number, pointX: number, pointY: number): {
    width: number
    height: number
    bytes: Buffer
  }
}

export interface NativePreviewCapabilities {
  platform: string
  decoder: string
  systemHardwareDecode: boolean
  externalGpuTexture: boolean
  directGpuPresentation: boolean
}

export interface NativePreviewBounds {
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

export interface NativePreviewSessionStats {
  renderedFrames: number
  renderErrors: number
  currentTime: number
  cacheHits: number
  cacheMisses: number
}

let native: LunaRenderCoreNative | null = null

export function getNative(): LunaRenderCoreNative {
  if (native) return native

  // 遍历多个候选路径加载 .node addon：
  //   1. 打包后：process.resourcesPath/luna-render-core/luna-render-core.node
  //      （extraResources 将 luna-render-core 复制到 resources/）
  //   2. 开发时：APP_ROOT/luna-render-core/luna-render-core.node
  //      （build-native.mjs 复制到项目根目录 luna-render-core/）
  const appRootNative = join(
    process.env.APP_ROOT || join(import.meta.dirname, '..'),
    'luna-render-core',
    'luna-render-core.node',
  )
  const packagedNative = join(process.resourcesPath || '', 'luna-render-core', 'luna-render-core.node')
  // 热更新的 appMain 会将 APP_ROOT 指向 userData/.luna-hot，必须优先加载
  // 其中已切换的新原生模块；正式安装包则回退到 resources 目录。
  const candidates = [appRootNative, packagedNative]
  const attempts: string[] = []
  for (const nodePath of candidates) {
    try {
      native = require(nodePath) as LunaRenderCoreNative
      return native!
    } catch (error) {
      const present = existsSync(nodePath)
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'UNKNOWN')
        : 'UNKNOWN'
      const message = error instanceof Error ? error.message : String(error)
      attempts.push(`  - [${present ? 'present' : 'missing'}] ${nodePath}\n    code=${code}\n    error=${message}`)
    }
  }
  throw new Error(
    `LRC_NATIVE_LOAD_FAILED: 无法加载预览组件。\n${attempts.join('\n')}`,
  )
}

let initialized = false
let initializing = false
let warmupTask: Promise<void> | null = null
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
  if (initializing) {
    throw new Error('Luna Render Core is already initializing')
  }
  if (!app.isPackaged && existsSync(initGuardPath())) clearInitGuard()
  if (existsSync(initGuardPath())) {
    throw new Error(`${LRC_COMPATIBILITY_BLOCKED}: previous native initialization did not complete`)
  }

  initializing = true
  writeInitGuard()
  try {
    getNative().initCompositor(logPath ?? undefined)
    initialized = true
    clearInitGuard()
  } catch (error) {
    clearInitGuard()
    throw error
  } finally {
    initializing = false
  }
}

/**
 * 页面展示后预热原生渲染器。主进程内共享同一个任务，避免页面重载重复初始化。
 */
export function warmupRenderCore(logPath?: string): Promise<void> {
  if (initialized) return Promise.resolve()
  if (warmupTask) return warmupTask
  if (!app.isPackaged && existsSync(initGuardPath())) clearInitGuard()
  if (existsSync(initGuardPath())) {
    return Promise.reject(new Error(`${LRC_COMPATIBILITY_BLOCKED}: previous native initialization did not complete`))
  }

  initializing = true
  warmupTask = Promise.resolve()
    .then(() => {
      writeInitGuard()
      return getNative().initCompositorAsync(logPath ?? undefined)
    })
    .then(() => {
      initialized = true
      clearInitGuard()
    })
    .catch((error) => {
      clearInitGuard()
      throw error
    })
    .finally(() => {
      initializing = false
      warmupTask = null
    })
  return warmupTask
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

export async function renderCompositionFrameAsync(
  ffmpegPath: string,
  ffprobePath: string,
  composition: CompositionInput,
  time: number,
  maxSide?: number,
): Promise<RenderPreviewOutput> {
  await warmupRenderCore()
  return getNative().renderCompositionFrameAsync(cleanNativeInput({ ffmpegPath, ffprobePath, composition, time, maxSide }))
}

export async function exportCompositionVideoAsync(input: {
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
  await warmupRenderCore()
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

export async function exportCompositionImageAsync(input: {
  ffmpegPath: string
  ffprobePath: string
  outputPath: string
  composition: CompositionInput
  format: string
  quality: number
}): Promise<void> {
  await warmupRenderCore()
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

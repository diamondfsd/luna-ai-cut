import type { CompositionInput, PreviewLayer } from '../shared/types'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import type { VideoExportSettings, VideoResolution, VideoFrameRate, VideoQuality } from '../shared/types'
import { buildLayers } from './PreviewStage'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import { buildResolvedWatermarkStaticLayer } from './WatermarkSettings'
import { logExport } from '../lib/rendererLogger'
import { resolveVideoExportResolution, normalizeVideoDimensions } from '../lib/videoExportResolution'


interface LunaRenderCoreApi {
  exportCompositionVideo(
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
    exportTaskId?: string,
    exportItemId?: string,
    includeAudio?: boolean,
  ): Promise<void>
  exportCompositionImage(
    outputPath: string,
    composition: CompositionInput,
    format: string,
    quality: number,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
}

function lrc(): LunaRenderCoreApi {
  const api = (window as unknown as { lunaRenderCore?: LunaRenderCoreApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

export function renderCoreProgress(taskId: string): Promise<[number | bigint, number | bigint] | null> {
  const api = (window as unknown as {
    lunaRenderCore?: { getExportTaskProgress?: (taskId: string) => Promise<[number | bigint, number | bigint] | null> }
  }).lunaRenderCore
  return api?.getExportTaskProgress?.(taskId) ?? Promise.resolve(null)
}

function exportCanvasFor(resolution: { width: number; height: number }): { width: number; height: number } {
  const max = 1440
  const aspect = resolution.width / resolution.height
  if (aspect >= 1) return { width: max, height: Math.round(max / aspect) }
  return { width: Math.round(max * aspect), height: max }
}

/**
 * 根据导出分辨率预设计算目标尺寸
 * - 'original': 保持源文件原始尺寸
 * - '1080p': 高度 1080，宽度按比例缩放
 * - '2k': 宽度 2560，高度按比例缩放
 * - '4k': 宽度 3840，高度按比例缩放
 */
export function resolveExportResolution(
  originalWidth: number,
  originalHeight: number,
  resolution: VideoResolution,
): { width: number; height: number } {
  return resolveVideoExportResolution(originalWidth, originalHeight, resolution)
}

/** 根据帧率预设解析数值，'original' 返回 null（由 Rust 决定） */
export function resolveExportFps(frameRate: VideoFrameRate): number | null {
  if (frameRate === 'original' || frameRate === undefined) return null
  const num = parseFloat(frameRate as string)
  return isNaN(num) ? null : num
}

/**
 * 根据质量预设映射到 Rust QualityPreset 字符串
 *
 * Rust 侧定义:
 * - 'original'   → 使用源视频码率
 * - 'small'       → ~12 Mbps
 * - 'standard'    → ~24 Mbps
 * - 'high'        → ~50 Mbps
 * - 'original-like' → ~80 Mbps
 */
export function resolveExportQualityPreset(
  quality: VideoQuality,
  customBitrate?: number,
): string | undefined {
  switch (quality) {
    case 'original': return 'original'
    case 'low': return 'small'
    case 'medium': return 'standard'
    case 'high': return 'high'
    case 'custom':
      if (customBitrate && customBitrate > 0) {
        // mbps → kbps，发给 Rust 的 "custom:50000k" 格式
        return `custom:${customBitrate * 1000}k`
      }
      return 'original-like'
    default: return undefined
  }
}

/**
 * 将 UI 导出配置统一解析为 Rust 导出参数
 */
export function resolveExportConfig(
  config: VideoExportSettings | undefined | null,
  originalWidth: number,
  originalHeight: number,
): {
  width: number
  height: number
  fps: number | null
  qualityPreset: string | undefined
  includeAudio: boolean
} {
  const res = config?.resolution
    ? resolveExportResolution(originalWidth, originalHeight, config.resolution)
    : normalizeVideoDimensions(originalWidth, originalHeight)

  return {
    width: res.width,
    height: res.height,
    fps: config ? resolveExportFps(config.frameRate) : null,
    qualityPreset: config ? resolveExportQualityPreset(config.quality, config.customBitrate) : undefined,
    includeAudio: config?.includeAudio !== false,
  }
}

export function buildExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  watermark?: WatermarkSettingsType | null,
): PreviewLayer[] {
  const main = buildLayers(sourcePath, resolution, exportCanvasFor(resolution))
  if (!watermark?.enabled) return main

  // 与工作台预览保持一致：imagePath 未写入项目时，由水印构建器按 style 使用预加载资源兜底。
  const watermarkLayer = buildResolvedWatermarkStaticLayer(watermark, resolution.width, resolution.height)
  const baseLayer = main[0]
  if (!watermarkLayer || !baseLayer) return main

  return [
    ...main,
    {
      ...watermarkLayer,
      dstX: baseLayer.dstX + watermarkLayer.dstX * baseLayer.dstW,
      dstY: baseLayer.dstY + watermarkLayer.dstY * baseLayer.dstH,
      dstW: watermarkLayer.dstW * baseLayer.dstW,
      dstH: watermarkLayer.dstH * baseLayer.dstH,
    },
  ]
}

export function emitLocalExportProgress(progress: {
  exportId: string
  taskId: string
  taskName: string
  fileName: string
  index: number
  totalFiles: number
  percent: number | null
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  destinationPath?: string
  error?: string
}): void {
  window.dispatchEvent(new CustomEvent('luna:export-progress-local', { detail: progress }))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function exportPreviewImage(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  format: 'jpeg' | 'png' | 'webp'
  quality: number
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
}): Promise<{ path: string; name: string }> {
  const path = outputPath(params.exportDir, params.fileName)
  const composition = buildCompositionFromPreviewLayers(params.layers, params.width, params.height)
  await lrc().exportCompositionImage(path, composition, params.format, params.quality, params.exportTaskId, params.exportItemId)
  return { path, name: params.fileName }
}

export async function exportPreviewVideo(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  qualityPreset?: string
  /** 帧率覆盖（null / undefined 表示使用源文件帧率） */
  fps?: number | null
  /** 是否保留源视频中的音频。 */
  includeAudio?: boolean
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
  taskName?: string
  index?: number
  totalFiles?: number
  /** 仅用于读取原生逐帧进度，不会额外创建导出记录。 */
  renderTaskId?: string
  onProgress?: (percent: number) => void | Promise<void>
}): Promise<{ path: string; name: string }> {
  if (!params.layers.some((layer) => layer.isVideo)) throw new Error('未找到视频图层')

  const path = outputPath(params.exportDir, params.fileName)
  const taskId = params.exportTaskId
  const itemId = params.exportItemId
  const taskName = params.taskName ?? '导出任务'
  const index = params.index ?? 0
  const totalFiles = params.totalFiles ?? 1
  const renderTaskId = params.renderTaskId ?? itemId
  const emitVideoProgress = (percent: number, status: 'exporting' | 'done' | 'failed', error?: string) => {
    if (!taskId || !itemId) return
    emitLocalExportProgress({ exportId: itemId, taskId, taskName, fileName: params.fileName, index, totalFiles, percent, status, destinationPath: path, error })
  }
  let lastPercent = 0
  const reportVideoProgress = async (percent: number): Promise<void> => {
    if (percent <= lastPercent) return
    lastPercent = percent
    await params.onProgress?.(percent)
    if (taskId && itemId) {
      await window.luna.exportTask.updateItem(taskId, itemId, { status: 'exporting', progress: percent }).catch(() => {})
      emitVideoProgress(percent, 'exporting')
    }
  }
  logExport('[导出诊断] 视频渲染路径', {
    renderer: 'rust-wgpu',
    reason: '浏览器端导出加速已移除，统一使用原生 wgpu 导出',
  })
  let stopProgressWatcher = false
  const progressWatchers: Promise<void>[] = []
  const startNativeProgressWatcher = (): void => {
    if (progressWatchers.length > 0 || !renderTaskId || (!params.onProgress && !(taskId && itemId))) return
    progressWatchers.push((async () => {
      while (!stopProgressWatcher) {
        const progress = await renderCoreProgress(renderTaskId).catch(() => null)
        if (progress) {
          const currentFrame = Number(progress[0])
          const totalFrames = Number(progress[1])
          if (totalFrames > 1) {
            const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
            await reportVideoProgress(percent)
          }
        }
        await wait(500)
      }
    })())
  }

  try {
    const exportFps = params.fps ?? null
    const composition = buildCompositionFromPreviewLayers(
      params.layers,
      params.width,
      params.height,
      { fps: exportFps ?? undefined },
    )
    logExport('[导出诊断] 视频最终参数', {
      sourcePaths: [...new Set(params.layers.map((layer) => layer.filePath).filter(Boolean))],
      requestedSize: { width: params.width, height: params.height },
      compositionCanvas: composition.canvas,
      fps: exportFps,
      qualityPreset: params.qualityPreset ?? 'high',
      includeAudio: params.includeAudio !== false,
    })
    const exportWithNative = async (): Promise<void> => {
      startNativeProgressWatcher()
      await lrc().exportCompositionVideo(
        path,
        composition,
        exportFps,
        null,
        true,
        renderTaskId,
        params.qualityPreset ?? 'high',
        taskId,
        itemId,
        params.includeAudio !== false,
      )
    }
    await exportWithNative()
    if (taskId && itemId) {
      await window.luna.exportTask.updateItem(taskId, itemId, { status: 'done', progress: 100, destinationPath: path }).catch(() => {})
      emitVideoProgress(100, 'done')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (taskId && itemId) {
      await window.luna.exportTask.updateItem(taskId, itemId, { status: 'failed', error: message }).catch(() => {})
      emitVideoProgress(100, 'failed', message)
    }
    throw error
  } finally {
    stopProgressWatcher = true
    await Promise.all(progressWatchers).catch(() => {})
  }
  return { path, name: params.fileName }
}

export async function exportPreviewLivePhoto(params: {
  name: string
  exportDir: string
  width: number
  height: number
  imageLayers: PreviewLayer[]
  videoLayers: PreviewLayer[]
  appleLivePhoto: boolean
  /** 是否保留视频片段中的音频。 */
  includeAudio?: boolean
  /** 视频编码质量预设。 */
  qualityPreset?: string
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
  taskName?: string
  index?: number
  totalFiles?: number
}): Promise<{ path: string; name: string }> {
  const stamp = Date.now()
  const outputDir = params.exportDir.replace(/[\\/]$/, '')
  const tempImagePath = `${outputDir}/${params.name}_live_image_${stamp}.jpg`
  const tempVideoPath = `${outputDir}/${params.name}_live_video_${stamp}.mp4`
  const tempImageName = `${params.name}_live_image_${stamp}.jpg`
  const tempVideoName = `${params.name}_live_video_${stamp}.mp4`
  const fileName = `${params.name}_${stamp}.jpg`
  const taskId = params.exportTaskId
  const itemId = params.exportItemId
  const _taskName = params.taskName ?? 'Live 图导出'
  const _index = params.index ?? 0
  const _totalFiles = params.totalFiles ?? 1

  const emitProgress = (percent: number, status: 'exporting' | 'done' | 'failed', destinationPath?: string, error?: string) => {
    if (!taskId || !itemId) return
    emitLocalExportProgress({
      exportId: itemId, taskId, taskName: _taskName, fileName,
      index: _index, totalFiles: _totalFiles, percent, status,
      destinationPath: destinationPath ?? tempImagePath, error,
    })
  }

  try {
    // Step 1: 调用导出图片方法
    emitProgress(5, 'exporting')
    await exportPreviewImage({
      exportDir: outputDir,
      fileName: tempImageName,
      width: params.width,
      height: params.height,
      layers: params.imageLayers,
      format: 'jpeg',
      quality: 100,
    })
    emitProgress(35, 'exporting')

    // Step 2: 调用导出视频方法
    await exportPreviewVideo({
      exportDir: outputDir,
      fileName: tempVideoName,
      width: params.width,
      height: params.height,
      layers: params.videoLayers,
      qualityPreset: params.qualityPreset ?? 'high',
      includeAudio: params.includeAudio,
    })
    emitProgress(65, 'exporting')

    // Step 3: 合并为 Google Motion Photo（后端自动清理临时文件）
    console.log('[LiveExport] Step3: calling exportRenderedLivePhoto', {
      name: params.name, appleLivePhoto: params.appleLivePhoto,
      imagePath: tempImagePath, videoPath: tempVideoPath,
    })
    const result = await window.luna.workspace.exportRenderedLivePhoto(
      params.name, tempImagePath, tempVideoPath, params.appleLivePhoto,
      false, true, undefined, outputDir,
    )

    if (taskId && itemId) {
      await window.luna.exportTask.updateItem(taskId, itemId, {
        status: 'done', progress: 100, destinationPath: result.path,
      }).catch(() => {})
    }
    emitProgress(100, 'done', result.path)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitProgress(100, 'failed', undefined, message)
    throw error
  }
}

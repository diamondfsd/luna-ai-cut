import type { CompositionInput, PreviewLayer } from '../shared/types'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import type { ImageExportFormat, VideoExportSettings, VideoResolution, VideoFrameRate, VideoQuality } from '../shared/types'
import { buildLayers } from './PreviewStage'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import { buildResolvedWatermarkStaticLayer } from './WatermarkSettings'
import { getIsLivePhoto } from '../shared/livePhoto'
import { snapshotPreviewLayers } from '../workspace/shared/exportLayerSnapshot'
import { canUseWebGpuVideoExportComposition, canUseWebGpuStaticImageComposition } from '../lib/webgpu/static-image-capabilities'
import { renderStaticImageCompositionToBlob, type WebGpuImageExportFormat } from '../lib/webgpu/static-image-export'
import { exportVideoWithWebGpuWorker } from '../lib/webgpu/video-export'

const IMAGE_EXPORT_CONCURRENCY = 2
const VIDEO_EXPORT_CONCURRENCY = 1
const EXPORT_STATUS_POLL_MS = 1000

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

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || 'export'
}

async function ensureExportActive(exportTaskId?: string, exportItemId?: string): Promise<void> {
  if (!exportTaskId || !exportItemId) return
  const task = await window.luna.exportTask.get(exportTaskId).catch(() => undefined)
  const item = task?.items.find((candidate) => candidate.id === exportItemId)
  if (task?.status === 'canceled' || item?.status === 'canceled') throw new Error('导出已取消')
}

async function writeBlobToExportDirectory(
  exportDir: string,
  fileName: string,
  blob: Blob,
  exportTaskId?: string,
  exportItemId?: string,
): Promise<{ path: string; name: string }> {
  await ensureExportActive(exportTaskId, exportItemId)
  const opened = await window.luna.freecutExport.openWriter(exportDir, fileName)
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const chunkSize = 8 * 1024 * 1024
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      await ensureExportActive(exportTaskId, exportItemId)
      const chunk = bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength))
      await window.luna.freecutExport.writeWriter(opened.writerId, chunk.buffer)
    }
    await ensureExportActive(exportTaskId, exportItemId)
    const closed = await window.luna.freecutExport.closeWriter(opened.writerId)
    return { path: closed.filePath, name: closed.fileName }
  } catch (error) {
    await window.luna.freecutExport.abortWriter(opened.writerId).catch(() => undefined)
    throw error
  }
}

function baseNameFromPath(path: string): string {
  return fileNameFromPath(path).replace(/\.[^.]+$/, '')
}

export function resolveImageExportFormat(settings?: VideoExportSettings | null): ImageExportFormat {
  return settings?.imageFormat ?? 'jpeg'
}

export function imageExportExtension(format: ImageExportFormat): string {
  return format === 'jpeg' ? '.jpg' : `.${format}`
}

function sourceMatchesImageFormat(sourcePath: string, format: ImageExportFormat): boolean {
  const extension = fileNameFromPath(sourcePath).match(/(\.[^.]+)$/)?.[1].toLowerCase()
  if (format === 'jpeg') return extension === '.jpg' || extension === '.jpeg'
  return extension === imageExportExtension(format)
}

function usesOriginalImageSettings(settings?: VideoExportSettings | null): boolean {
  return !settings || settings.resolution === 'original' || settings.resolution === undefined
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
  if (resolution === 'original' || resolution === undefined) {
    return { width: originalWidth, height: originalHeight }
  }

  const aspect = originalWidth / originalHeight

  switch (resolution) {
    case '1080p':
      return { width: Math.round(1080 * aspect), height: 1080 }
    case '2k':
      return { width: 2560, height: Math.round(2560 / aspect) }
    case '4k':
      return { width: 3840, height: Math.round(3840 / aspect) }
    default:
      return { width: originalWidth, height: originalHeight }
  }
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
    case 'original': return undefined
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
    : { width: originalWidth, height: originalHeight }

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
  backend?: 'webgpu'
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
  if (canUseWebGpuStaticImageComposition(params.layers)) {
    await ensureExportActive(params.exportTaskId, params.exportItemId)
    if (params.exportTaskId && params.exportItemId) {
      await window.luna.exportTask.updateItem(params.exportTaskId, params.exportItemId, {
        status: 'exporting',
        progress: 0,
      }).catch(() => undefined)
      emitLocalExportProgress({
        exportId: params.exportItemId,
        taskId: params.exportTaskId,
        taskName: '图片导出',
        fileName: params.fileName,
        index: 0,
        totalFiles: 1,
        percent: 0,
        status: 'exporting',
        destinationPath: path,
        backend: 'webgpu',
      })
    }
    const blob = await renderStaticImageCompositionToBlob({
      composition,
      format: params.format as WebGpuImageExportFormat,
      quality: params.quality,
    })
    await ensureExportActive(params.exportTaskId, params.exportItemId)
    const result = await writeBlobToExportDirectory(
      params.exportDir,
      params.fileName,
      blob,
      params.exportTaskId,
      params.exportItemId,
    )
    await ensureExportActive(params.exportTaskId, params.exportItemId)
    const sourcePath = composition.layers.find((layer) => layer.layerType === 'media')?.source.path
    if (params.format === 'jpeg' && sourcePath) {
      await window.luna.freecutExport.embedJpegSourceMetadata(result.path, sourcePath).catch(() => false)
    }
    if (params.exportTaskId && params.exportItemId) {
      await window.luna.exportTask.updateItem(params.exportTaskId, params.exportItemId, {
        status: 'done',
        progress: 100,
        destinationPath: result.path,
      }).catch(() => undefined)
      emitLocalExportProgress({
        exportId: params.exportItemId,
        taskId: params.exportTaskId,
        taskName: '图片导出',
        fileName: result.name,
        index: 0,
        totalFiles: 1,
        percent: 100,
        status: 'done',
        destinationPath: result.path,
        backend: 'webgpu',
      })
    }
    return result
  }
  // 复杂图层会在对应 WebGPU 阶段完成后接入；这里不是 WebGPU 失败回退。
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
  if (canUseWebGpuVideoExportComposition(params.layers)) {
    try {
      const composition = buildCompositionFromPreviewLayers(
        params.layers,
        params.width,
        params.height,
        { fps: params.fps ?? undefined },
      )
      const sourcePath = params.layers.find((layer) => layer.isVideo)?.filePath
      if (!sourcePath) throw new Error('未找到视频素材')
      if (taskId && itemId) {
        await window.luna.exportTask.updateItem(taskId, itemId, { status: 'exporting', progress: 0 }).catch(() => {})
        emitLocalExportProgress({
          exportId: itemId,
          taskId,
          taskName,
          fileName: params.fileName,
          index,
          totalFiles,
          percent: 0,
          status: 'exporting',
          destinationPath: path,
          backend: 'webgpu',
        })
      }
      const result = await exportVideoWithWebGpuWorker({
        sourcePath,
        composition,
        width: params.width,
        height: params.height,
        fps: params.fps ?? null,
        qualityPreset: params.qualityPreset ?? 'high',
        includeAudio: params.includeAudio !== false,
        exportTaskId: taskId,
        exportItemId: itemId,
        onProgress: async (progress) => {
          await params.onProgress?.(progress.progress)
          if (taskId && itemId) {
            await window.luna.exportTask.updateItem(taskId, itemId, {
              status: 'exporting',
              progress: progress.progress,
            }).catch(() => {})
            emitLocalExportProgress({
              exportId: itemId,
              taskId,
              taskName,
              fileName: params.fileName,
              index,
              totalFiles,
              percent: progress.progress,
              status: 'exporting',
              destinationPath: path,
              backend: 'webgpu',
            })
          }
        },
      })
      await ensureExportActive(taskId, itemId)
      const written = await writeBlobToExportDirectory(
        params.exportDir,
        params.fileName,
        result.blob,
        taskId,
        itemId,
      )
      await ensureExportActive(taskId, itemId)
      if (taskId && itemId) {
        await window.luna.exportTask.updateItem(taskId, itemId, {
          status: 'done',
          progress: 100,
          destinationPath: written.path,
        }).catch(() => {})
        emitLocalExportProgress({
          exportId: itemId,
          taskId,
          taskName,
          fileName: written.name,
          index,
          totalFiles,
          percent: 100,
          status: 'done',
          destinationPath: written.path,
          backend: 'webgpu',
        })
      }
      return written
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const canceled = message === '视频导出已取消' || (error instanceof Error && error.name === 'AbortError')
      if (taskId && itemId) {
        await window.luna.exportTask.updateItem(taskId, itemId, {
          status: canceled ? 'canceled' : 'failed',
          error: message,
        }).catch(() => {})
        emitLocalExportProgress({
          exportId: itemId,
          taskId,
          taskName,
          fileName: params.fileName,
          index,
          totalFiles,
          percent: 100,
          status: canceled ? 'canceled' : 'failed',
          destinationPath: path,
          error: message,
          backend: 'webgpu',
        })
      }
      throw error
    }
  }
  const emitVideoProgress = (percent: number, status: 'exporting' | 'done' | 'failed', error?: string) => {
    if (!taskId || !itemId) return
    emitLocalExportProgress({ exportId: itemId, taskId, taskName, fileName: params.fileName, index, totalFiles, percent, status, destinationPath: path, error })
  }
  let stopProgressWatcher = false
  let lastPercent = 0
  const progressWatcher = renderTaskId && (params.onProgress || (taskId && itemId)) ? (async () => {
    while (!stopProgressWatcher) {
      const progress = await renderCoreProgress(renderTaskId).catch(() => null)
      if (progress) {
        const currentFrame = Number(progress[0])
        const totalFrames = Number(progress[1])
        if (totalFrames > 1) {
          const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
          if (percent > lastPercent) {
            lastPercent = percent
            await params.onProgress?.(percent)
            if (taskId && itemId) {
              await window.luna.exportTask.updateItem(taskId, itemId, { status: 'exporting', progress: percent }).catch(() => {})
              emitVideoProgress(percent, 'exporting')
            }
          }
        }
      }
      await wait(500)
    }
  })() : null

  try {
    const exportFps = params.fps ?? null
    const composition = buildCompositionFromPreviewLayers(
      params.layers,
      params.width,
      params.height,
      { fps: exportFps ?? undefined },
    )
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
    await progressWatcher?.catch(() => {})
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
    const imageResult = await exportPreviewImage({
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
      qualityPreset: 'high',
      includeAudio: params.includeAudio,
    })
    emitProgress(65, 'exporting')

    // Step 3: 合并为 Google Motion Photo（后端自动清理临时文件）
    console.log('[LiveExport] Step3: calling exportRenderedLivePhoto', {
      name: params.name, appleLivePhoto: params.appleLivePhoto,
      imagePath: tempImagePath, videoPath: tempVideoPath,
    })
    const result = await window.luna.workspace.exportRenderedLivePhoto(
      params.name, imageResult.path, tempVideoPath, params.appleLivePhoto,
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

// ── 公共批量导出 ──

export interface BatchExportSource {
  sourcePath: string
  layers?: PreviewLayer[]
  outputBaseName?: string
  outputSize?: { width: number; height: number }
  /** 没有应用任何编辑或水印时，允许保留原格式直接复制。 */
  passthrough?: boolean
  /** 裁剪后的可用视频时长，Live 图固定从中选择 3 秒。 */
  mediaDuration?: number
  /** 原始视频时长，用于复用统一的胶片缩略图缓存。 */
  sourceDuration?: number
}

interface BatchExportEntry {
  id: string
  sourcePath: string
  outputPath: string
  layers?: PreviewLayer[]
  outputSize?: { width: number; height: number }
  passthrough?: boolean
  index: number
  kind: 'image' | 'video'
  isLivePhoto?: boolean
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index])
    }
  })
  await Promise.all(workers)
}

function renderCoreProgress(taskId: string): Promise<[number | bigint, number | bigint] | null> {
  const api = (window as unknown as {
    lunaRenderCore?: { getExportTaskProgress?: (taskId: string) => Promise<[number | bigint, number | bigint] | null> }
  }).lunaRenderCore
  return api?.getExportTaskProgress?.(taskId) ?? Promise.resolve(null)
}

async function waitForExportItem(
  taskId: string,
  taskName: string,
  entry: BatchExportEntry,
  totalFiles: number,
): Promise<void> {
  let lastPercent = 0
  for (;;) {
    const progress = await renderCoreProgress(entry.id).catch(() => null)
    if (progress) {
      const currentFrame = Number(progress[0])
      const totalFrames = Number(progress[1])
      if (totalFrames > 1) {
        const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
        if (percent > lastPercent) {
          lastPercent = percent
          await window.luna.exportTask.updateItem(taskId, entry.id, {
            status: 'exporting',
            progress: percent,
          }).catch(() => {})
          emitLocalExportProgress({
            exportId: entry.id,
            taskId,
            taskName,
            fileName: fileNameFromPath(entry.outputPath),
            index: entry.index,
            totalFiles,
            percent,
            status: 'exporting',
            destinationPath: entry.outputPath,
          })
        }
      }
    }

    const task = await window.luna.exportTask.get(taskId)
    const item = task?.items.find((candidate) => candidate.id === entry.id)
    if (!item) return
    if (item.status === 'done') return
    if (item.status === 'failed') throw new Error(item.error || '导出失败')
    if (item.status === 'canceled') throw new Error('导出已取消')
    await wait(EXPORT_STATUS_POLL_MS)
  }
}

async function runBatchExportQueue(
  taskId: string,
  taskName: string,
  exportDir: string,
  entries: BatchExportEntry[],
  exportConfig?: VideoExportSettings | null,
  appleLivePhoto = false,
): Promise<void> {
  const exportOne = async (entry: BatchExportEntry): Promise<void> => {
    const task = await window.luna.exportTask.get(taskId)
    const itemStatus = task?.items.find((item) => item.id === entry.id)?.status
    if (itemStatus === 'canceled') {
      emitLocalExportProgress({
        exportId: entry.id,
        taskId,
        taskName,
        fileName: fileNameFromPath(entry.outputPath),
        index: entry.index,
        totalFiles: entries.length,
        percent: 0,
        status: 'canceled',
        destinationPath: entry.outputPath,
      })
      return
    }

    emitLocalExportProgress({
      exportId: entry.id,
      taskId,
      taskName,
      fileName: fileNameFromPath(entry.outputPath),
      index: entry.index,
      totalFiles: entries.length,
      percent: 0,
      status: 'exporting',
      destinationPath: entry.outputPath,
    })

    try {
      await window.luna.exportTask.updateItem(taskId, entry.id, {
        status: 'exporting',
        progress: 0,
      }).catch(() => {})
      const res = await window.luna.workspace.getMediaResolution(entry.sourcePath)
      const outputSize = entry.outputSize ?? res
      const resolved = resolveExportConfig(exportConfig, outputSize.width, outputSize.height)
      const exportLayers = entry.layers ?? buildExportLayers(entry.sourcePath, res)
      const fileName = fileNameFromPath(entry.outputPath)

      // ── 检测是否为 Live Photo ──
      if (entry.kind === 'image') {
        const isLive = entry.isLivePhoto ?? (await getIsLivePhoto(entry.sourcePath))
        if (isLive) {
          try {
            const videoResult = await window.luna.previewLivePhoto(entry.sourcePath)
            const videoUrl = videoResult.source
            if (videoUrl) {
              const videoRes = await window.luna.workspace.getMediaResolution(videoUrl).catch(() => res)
              const videoLayers: PreviewLayer[] = exportLayers.map((layer, i) =>
                i === 0 ? { ...layer, filePath: videoUrl, isVideo: true } : layer,
              )
              const baseName = baseNameFromPath(entry.sourcePath)
              if (appleLivePhoto) {
                // Apple Live 开启：创建 2 个独立子任务（Live + Apple Live）
                const liveStamp = Date.now()

                // 先更新原 entry 为 Live 图导出
                await window.luna.exportTask.updateItem(taskId, entry.id, {
                  label: 'Live 图导出',
                }).catch(() => {})

                // Step 1: Live 图导出（复用当前 entry）
                if (entry.passthrough) {
                  await window.luna.workspace.exportOriginalFile({
                    sourcePath: entry.sourcePath,
                    outputPath: entry.outputPath,
                    exportTaskId: taskId,
                    exportItemId: entry.id,
                  })
                } else {
                  await exportPreviewLivePhoto({
                    name: baseName, exportDir, width: videoRes.width, height: videoRes.height,
                    imageLayers: exportLayers, videoLayers,
                    appleLivePhoto: false,
                    includeAudio: exportConfig?.includeAudio !== false,
                    exportTaskId: taskId, exportItemId: entry.id,
                    taskName, index: entry.index, totalFiles: entries.length,
                  })
                }

                // Step 2: 添加 Apple Live 子任务
                const appleItemId = `${entry.id}_appleLive`
                console.log('[LiveExport] Step2: starting Apple Live export', { baseName, exportDir, width: videoRes.width, height: videoRes.height, appleItemId })
                console.log('[LiveExport] exportRenderedLivePhoto available:', typeof window.luna.workspace.exportRenderedLivePhoto)
                await window.luna.exportTask.addItems(taskId, [
                  {
                    id: appleItemId,
                    sourcePath: entry.sourcePath,
                    outputPath: `${exportDir.replace(/[\\/]$/, '')}/${baseName}_appleLive_${liveStamp}.jpg`,
                    label: 'Apple Live 图导出',
                    openTarget: 'photos',
                    previewable: false,
                  },
                ])
                emitLocalExportProgress({ exportId: appleItemId, taskId, taskName, fileName: `${baseName}_appleLive_${liveStamp}.jpg`, index: entry.index, totalFiles: entries.length, percent: 0, status: 'exporting', destinationPath: `${exportDir.replace(/[\\/]$/, '')}/${baseName}_appleLive_${liveStamp}.jpg` })
                try {
                  await exportPreviewLivePhoto({
                    name: baseName, exportDir, width: videoRes.width, height: videoRes.height,
                    imageLayers: exportLayers, videoLayers,
                    appleLivePhoto: true,
                    includeAudio: exportConfig?.includeAudio !== false,
                    exportTaskId: taskId, exportItemId: appleItemId,
                    taskName, index: entry.index, totalFiles: entries.length,
                  })
                } catch (err) {
                  console.error('[LiveExport] Apple Live export failed:', err)
                  await window.luna.exportTask.updateItem(taskId, appleItemId, { status: 'failed', error: err instanceof Error ? err.message : String(err) }).catch(() => {})
                }
                return
              }

              // Apple Live 未开启：单一 Live 图导出
              if (entry.passthrough) {
                await window.luna.workspace.exportOriginalFile({
                  sourcePath: entry.sourcePath,
                  outputPath: entry.outputPath,
                  exportTaskId: taskId,
                  exportItemId: entry.id,
                })
              } else {
                await exportPreviewLivePhoto({
                  name: baseName,
                  exportDir,
                  width: videoRes.width,
                  height: videoRes.height,
                  imageLayers: exportLayers,
                  videoLayers,
                  appleLivePhoto: false,
                  includeAudio: exportConfig?.includeAudio !== false,
                  exportTaskId: taskId,
                  exportItemId: entry.id,
                  taskName,
                  index: entry.index,
                  totalFiles: entries.length,
                })
              }
              return
            }
          } catch {
            // Live Photo 视频提取失败时降级为图片导出
          }
        }
      }

      if (entry.passthrough) {
        await window.luna.workspace.exportOriginalFile({
          sourcePath: entry.sourcePath,
          outputPath: entry.outputPath,
          exportTaskId: taskId,
          exportItemId: entry.id,
        })
        return
      }

      if (entry.kind === 'video') {
        if (exportConfig?.dolbyVision) {
          if (exportLayers.length !== 2) throw new Error('Dolby Vision 导出仅支持原视频加一个静态水印')
          const [sourceLayer, watermarkLayer] = exportLayers
          if (!sourceLayer.isVideo || sourceLayer.filePath !== entry.sourcePath || watermarkLayer.isVideo || !watermarkLayer.positioning) {
            throw new Error('Dolby Vision 导出内容不符合要求')
          }
          const positioning = 'anchor' in watermarkLayer.positioning
            ? watermarkLayer.positioning
            : (outputSize.width >= outputSize.height ? watermarkLayer.positioning.landscape : watermarkLayer.positioning.portrait)
          if (!positioning) throw new Error('Dolby Vision 水印位置无效')
          await window.luna.workspace.exportDolbyVisionWatermark({
            sourcePath: entry.sourcePath,
            outputPath: entry.outputPath,
            watermarkPath: watermarkLayer.filePath,
            positioning,
            opacity: watermarkLayer.opacity ?? 1,
            includeAudio: exportConfig.includeAudio !== false,
            exportTaskId: taskId,
            exportItemId: entry.id,
          })
          return
        }
        await exportPreviewVideo({
          exportDir,
          fileName,
          width: resolved.width,
          height: resolved.height,
          layers: exportLayers,
          qualityPreset: resolved.qualityPreset ?? 'high',
          fps: resolved.fps,
          includeAudio: resolved.includeAudio,
          exportTaskId: taskId,
          exportItemId: entry.id,
          taskName,
          index: entry.index,
          totalFiles: entries.length,
        })
        await waitForExportItem(taskId, taskName, entry, entries.length)
        return
      }

      await exportPreviewImage({
        exportDir,
        fileName,
        width: resolved.width,
        height: resolved.height,
        layers: exportLayers,
        format: resolveImageExportFormat(exportConfig),
        quality: 100,
        exportTaskId: taskId,
        exportItemId: entry.id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await window.luna.exportTask.updateItem(taskId, entry.id, {
        status: message === '导出已取消' ? 'canceled' : 'failed',
        error: message,
      }).catch(() => {})
      emitLocalExportProgress({
        exportId: entry.id,
        taskId,
        taskName,
        fileName: fileNameFromPath(entry.outputPath),
        index: entry.index,
        totalFiles: entries.length,
        percent: 100,
        status: message === '导出已取消' ? 'canceled' : 'failed',
        destinationPath: entry.outputPath,
        error: message,
      })
    }
  }

  const imageEntries = entries.filter((entry) => entry.kind === 'image')
  const videoEntries = entries.filter((entry) => entry.kind === 'video')
  await Promise.all([
    runWithConcurrency(imageEntries, IMAGE_EXPORT_CONCURRENCY, exportOne),
    runWithConcurrency(videoEntries, VIDEO_EXPORT_CONCURRENCY, exportOne),
  ])
}

/**
 * 批量导出多个文件
 *
 * 职责：
 * - 创建导出任务（exportTask）
 * - 立即返回任务信息，让 UI 保持响应
 * - 后台按图片/视频并发限制执行导出
 * - 返回 taskId 和 items 信息
 *
 * PreviewModal 等 UI 组件调用此方法，不直接处理 lrc 细节。
 */
export async function exportBatchFiles(
  sources: Array<string | BatchExportSource>,
  exportDir: string,
  exportConfig?: VideoExportSettings | null,
  options?: { appleLivePhoto?: boolean },
): Promise<{ taskId: string; items: Array<{ id: string; outputPath: string }> }> {
  const sourceItems = sources.map((source) => (
    typeof source === 'string' ? { sourcePath: source } : source
  ))

  // 生成子任务列表
  const stamp = Date.now()
  const entries: BatchExportEntry[] = sourceItems.map((source, index) => {
    const fp = source.sourcePath
    const baseName = source.outputBaseName || baseNameFromPath(fp)
    const isVid = isVideoPathCached(fp)
    const imageFormat = resolveImageExportFormat(exportConfig)
    const canPassthrough = Boolean(source.passthrough) && (
      isVid
        ? usesOriginalVideoSettings(exportConfig)
        : usesOriginalImageSettings(exportConfig) && sourceMatchesImageFormat(fp, imageFormat)
    )
    const sourceExt = fileNameFromPath(fp).match(/(\.[^.]+)$/)?.[1]
    const ext = canPassthrough && sourceExt ? sourceExt : isVid ? '.mp4' : imageExportExtension(imageFormat)
    return {
      id: `batch_${baseName}_${stamp}_${Math.random().toString(36).slice(2, 6)}`,
      sourcePath: fp,
      outputPath: `${exportDir.replace(/[\\/]$/, '')}/${baseName}_${stamp}${ext}`,
      layers: snapshotPreviewLayers(source.layers),
      outputSize: source.outputSize,
      passthrough: canPassthrough,
      index,
      kind: isVid ? 'video' : 'image',
    }
  })

  // 创建导出任务
  const taskName = `批量导出 ${sourceItems.length} 个文件`
  const task = await window.luna.exportTask.create(
    taskName,
    entries.map((entry) => ({ id: entry.id, sourcePath: entry.sourcePath, outputPath: entry.outputPath })),
  )

  entries.forEach((entry) => {
    emitLocalExportProgress({
      exportId: entry.id,
      taskId: task.id,
      taskName,
      fileName: fileNameFromPath(entry.outputPath),
      index: entry.index,
      totalFiles: entries.length,
      percent: 0,
      status: 'queued',
      destinationPath: entry.outputPath,
    })
  })

  const queuedEntries = entries.map((entry) => ({ ...entry }))
  window.setTimeout(() => {
    void runBatchExportQueue(task.id, taskName, exportDir, queuedEntries, exportConfig, options?.appleLivePhoto)
  }, 0)

  return { taskId: task.id, items: entries.map((entry) => ({ id: entry.id, outputPath: entry.outputPath })) }
}

function usesOriginalVideoSettings(settings?: VideoExportSettings | null): boolean {
  if (!settings) return true
  return settings.resolution === 'original'
    && settings.frameRate === 'original'
    && settings.quality === 'original'
    && settings.includeAudio !== false
    && settings.customBitrate === undefined
    && settings.exportFormats.length === 1
    && settings.exportFormats[0] === 'video'
    && settings.trimStartTime === 0
    && settings.trimEndTime === undefined
}

/** 内部：根据扩展名判断是否视频 */
function isVideoPathCached(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'].includes(ext)
}

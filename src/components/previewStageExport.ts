import type { CompositionInput, PreviewLayer } from '../shared/types'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import type { VideoExportSettings, VideoResolution, VideoFrameRate, VideoQuality } from '../shared/types'
import { buildLayers } from './PreviewStage'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import { buildResolvedWatermarkStaticLayer } from './WatermarkSettings'
import { getIsLivePhoto } from '../shared/livePhoto'

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

function baseNameFromPath(path: string): string {
  return fileNameFromPath(path).replace(/\.[^.]+$/, '')
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
} {
  const res = config?.resolution
    ? resolveExportResolution(originalWidth, originalHeight, config.resolution)
    : { width: originalWidth, height: originalHeight }

  return {
    width: res.width,
    height: res.height,
    fps: config ? resolveExportFps(config.frameRate) : null,
    qualityPreset: config ? resolveExportQualityPreset(config.quality, config.customBitrate) : undefined,
  }
}

export function buildExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  watermark?: WatermarkSettingsType | null,
): PreviewLayer[] {
  const main = buildLayers(sourcePath, resolution, exportCanvasFor(resolution))
  if (!watermark?.enabled || !watermark.imagePath) return main

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
    await lrc().exportCompositionVideo(path, composition, exportFps, null, true, renderTaskId, params.qualityPreset ?? 'high', taskId, itemId)
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
      qualityPreset: 'high',
    })
    emitProgress(65, 'exporting')

    // Step 3: 合并为 Google Motion Photo（后端自动清理临时文件）
    console.log('[LiveExport] Step3: calling exportRenderedLivePhoto', {
      name: params.name, appleLivePhoto: params.appleLivePhoto,
      imagePath: tempImagePath, videoPath: tempVideoPath,
    })
    const result = await window.luna.workspace.exportRenderedLivePhoto(
      params.name, tempImagePath, tempVideoPath, params.appleLivePhoto,
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
              const appleLiveEnabled = (await window.luna.getSettings().catch(() => ({ exportAppleLivePhoto: false }))).exportAppleLivePhoto ?? false

              if (appleLiveEnabled) {
                // Apple Live 开启：创建 2 个独立子任务（Live + Apple Live）
                const liveStamp = Date.now()

                // 先更新原 entry 为 Live 图导出
                await window.luna.exportTask.updateItem(taskId, entry.id, {
                  label: 'Live 图导出',
                }).catch(() => {})

                // Step 1: Live 图导出（复用当前 entry）
                await exportPreviewLivePhoto({
                  name: baseName, exportDir, width: videoRes.width, height: videoRes.height,
                  imageLayers: exportLayers, videoLayers,
                  appleLivePhoto: false,
                  exportTaskId: taskId, exportItemId: entry.id,
                  taskName, index: entry.index, totalFiles: entries.length,
                })

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
              await exportPreviewLivePhoto({
                name: baseName,
                exportDir,
                width: videoRes.width,
                height: videoRes.height,
                imageLayers: exportLayers,
                videoLayers,
                appleLivePhoto: false,
                exportTaskId: taskId,
                exportItemId: entry.id,
                taskName,
                index: entry.index,
                totalFiles: entries.length,
              })
              return
            }
          } catch {
            // Live Photo 视频提取失败时降级为图片导出
          }
        }
      }

      if (entry.kind === 'video') {
        const resolved = resolveExportConfig(exportConfig, outputSize.width, outputSize.height)
        await exportPreviewVideo({
          exportDir,
          fileName,
          width: resolved.width,
          height: resolved.height,
          layers: exportLayers,
          qualityPreset: resolved.qualityPreset ?? 'high',
          fps: resolved.fps,
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
        width: outputSize.width,
        height: outputSize.height,
        layers: exportLayers,
        format: 'jpeg',
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
    const ext = isVid ? '.mp4' : '.jpg'
    return {
      id: `batch_${baseName}_${stamp}_${Math.random().toString(36).slice(2, 6)}`,
      sourcePath: fp,
      outputPath: `${exportDir.replace(/[\\/]$/, '')}/${baseName}_${stamp}${ext}`,
      layers: source.layers,
      outputSize: source.outputSize,
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

  const queuedEntries = entries.map((entry) => ({
    ...entry,
    layers: entry.layers,
  }))
  window.setTimeout(() => {
    void runBatchExportQueue(task.id, taskName, exportDir, queuedEntries, exportConfig)
  }, 0)

  return { taskId: task.id, items: entries.map((entry) => ({ id: entry.id, outputPath: entry.outputPath })) }
}

/** 内部：根据扩展名判断是否视频 */
function isVideoPathCached(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'].includes(ext)
}

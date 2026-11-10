import type { PreviewLayer, VideoExportSettings } from '../shared/types'
import type { ExportTaskPayload, LocalMediaExportTaskPayload } from '../shared/types'
import {
  buildExportLayers,
  emitLocalExportProgress,
  exportPreviewImage,
  exportPreviewLivePhoto,
  exportPreviewVideo,
  renderCoreProgress,
  resolveExportConfig,
} from './previewStageExport'
import { getIsLivePhoto } from '../shared/livePhoto'
import { snapshotPreviewLayers } from '../workspace/shared/exportLayerSnapshot'
import { createDirectoryExportNameAllocator } from '../lib/exportNameAllocator'
import { failUnfinishedExportItems } from '../lib/exportTaskRecovery'

const IMAGE_EXPORT_CONCURRENCY = 2
const VIDEO_EXPORT_CONCURRENCY = 1
const EXPORT_STATUS_POLL_MS = 1000

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || 'export'
}

function baseNameFromPath(path: string): string {
  return fileNameFromPath(path).replace(/\.[^.]+$/, '')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

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
  isLivePhoto?: boolean
}

type BatchExportEntry = LocalMediaExportTaskPayload['entries'][number]

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

async function runBatchExportQueue(taskId: string, payload: LocalMediaExportTaskPayload): Promise<void> {
  const { taskName, exportDir, entries, exportConfig, appleLivePhoto } = payload
  const exportOne = async (entry: BatchExportEntry): Promise<void> => {
    const task = await window.luna.exportTask.get(taskId)
    const itemStatus = task?.items.find((item) => item.id === entry.id)?.status
    if (itemStatus === 'canceled' || itemStatus === 'done') {
      if (itemStatus === 'done') return
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
      const outputBaseName = fileName.replace(/\.[^.]+$/, '')

      if (entry.role === 'apple-live') {
        const videoResult = await window.luna.previewLivePhoto(entry.sourcePath)
        if (!videoResult.source) throw new Error('没有在 Live 图中找到视频片段')
        const videoRes = await window.luna.workspace.getMediaResolution(videoResult.source).catch(() => res)
        const liveQualityPreset = exportConfig
          ? resolveExportConfig(exportConfig, videoRes.width, videoRes.height).qualityPreset ?? 'high'
          : 'high'
        const videoLayers = exportLayers.map((layer, index) => index === 0
          ? { ...layer, filePath: videoResult.source!, isVideo: true }
          : layer)
        await exportPreviewLivePhoto({
          name: outputBaseName,
          exportDir,
          width: videoRes.width,
          height: videoRes.height,
          imageLayers: exportLayers,
          videoLayers,
          appleLivePhoto: true,
          includeAudio: exportConfig?.includeAudio !== false,
          qualityPreset: liveQualityPreset,
          exportTaskId: taskId,
          exportItemId: entry.id,
          taskName,
          index: entry.index,
          totalFiles: entries.length,
        })
        return
      }

      // ── 检测是否为 Live Photo ──
      if (entry.kind === 'image') {
        const isLive = entry.isLivePhoto ?? (await getIsLivePhoto(entry.sourcePath))
        if (isLive) {
          try {
            const videoResult = await window.luna.previewLivePhoto(entry.sourcePath)
            const videoUrl = videoResult.source
            if (videoUrl) {
              const videoRes = await window.luna.workspace.getMediaResolution(videoUrl).catch(() => res)
              const liveQualityPreset = exportConfig
                ? resolveExportConfig(exportConfig, videoRes.width, videoRes.height).qualityPreset ?? 'high'
                : 'high'
              const videoLayers: PreviewLayer[] = exportLayers.map((layer, i) =>
                i === 0 ? { ...layer, filePath: videoUrl, isVideo: true } : layer,
              )
              if (appleLivePhoto) {
                await window.luna.exportTask.updateItem(taskId, entry.id, {
                  label: 'Live 图导出',
                }).catch(() => {})

                if (entry.passthrough) {
                  await window.luna.workspace.exportOriginalFile({
                    sourcePath: entry.sourcePath,
                    outputPath: entry.outputPath,
                    exportTaskId: taskId,
                    exportItemId: entry.id,
                  })
                } else {
                  await exportPreviewLivePhoto({
                    name: outputBaseName, exportDir, width: videoRes.width, height: videoRes.height,
                    imageLayers: exportLayers, videoLayers,
                    appleLivePhoto: false,
                    includeAudio: exportConfig?.includeAudio !== false,
                    qualityPreset: liveQualityPreset,
                    exportTaskId: taskId, exportItemId: entry.id,
                    taskName, index: entry.index, totalFiles: entries.length,
                  })
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
                  name: outputBaseName,
                  exportDir,
                  width: videoRes.width,
                  height: videoRes.height,
                  imageLayers: exportLayers,
                  videoLayers,
                  appleLivePhoto: false,
                  includeAudio: exportConfig?.includeAudio !== false,
                  qualityPreset: liveQualityPreset,
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
        const resolved = resolveExportConfig(exportConfig, outputSize.width, outputSize.height)
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

export async function resumeLocalMediaExportTask(taskId: string, payload: ExportTaskPayload): Promise<void> {
  if (payload.kind !== 'local-media') throw new Error('导出任务类型不匹配')
  await runBatchExportQueue(taskId, payload)
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
  const allocateName = await createDirectoryExportNameAllocator(exportDir)
  const mediaEntries: BatchExportEntry[] = sourceItems.map((source, index) => {
    const fp = source.sourcePath
    const baseName = source.outputBaseName || baseNameFromPath(fp)
    const isVid = isVideoPathCached(fp)
    const passthrough = Boolean(source.passthrough)
      && (!isVid || usesOriginalVideoSettings(exportConfig))
    const sourceExt = fileNameFromPath(fp).match(/(\.[^.]+)$/)?.[1]
    const ext = passthrough && sourceExt ? sourceExt : isVid ? '.mp4' : '.jpg'
    return {
      id: `batch_${baseName}_${stamp}_${Math.random().toString(36).slice(2, 6)}`,
      sourcePath: fp,
      outputPath: `${exportDir.replace(/[\\/]$/, '')}/${allocateName(`${baseName}${ext}`)}`,
      layers: snapshotPreviewLayers(source.layers),
      outputSize: source.outputSize,
      passthrough,
      index,
      kind: isVid ? 'video' : 'image',
      isLivePhoto: source.isLivePhoto,
      role: 'media',
    }
  })

  const appleLivePhoto = options?.appleLivePhoto === true
  const liveEntries = appleLivePhoto
    ? await Promise.all(mediaEntries.map(async (entry) => ({
      entry,
      isLivePhoto: entry.kind === 'image'
        ? entry.isLivePhoto ?? await getIsLivePhoto(entry.sourcePath)
        : false,
    })))
    : mediaEntries.map((entry) => ({ entry, isLivePhoto: Boolean(entry.isLivePhoto) }))
  const expandedEntries = liveEntries.flatMap(({ entry, isLivePhoto }) => {
    entry.isLivePhoto = isLivePhoto
    if (!appleLivePhoto || !isLivePhoto) return [entry]
    const baseName = baseNameFromPath(entry.sourcePath)
    return [entry, {
      ...entry,
      id: `${entry.id}_appleLive`,
      outputPath: `${exportDir.replace(/[\\/]$/, '')}/${allocateName(`${baseName}_appleLive.jpg`)}`,
      role: 'apple-live' as const,
    }]
  })
  const entries = expandedEntries.map((entry, index) => ({ ...entry, index }))

  // 创建导出任务
  const taskName = `批量导出 ${sourceItems.length} 个文件`
  const payload: LocalMediaExportTaskPayload = {
    version: 1,
    kind: 'local-media',
    exportDir,
    taskName,
    entries,
    exportConfig: exportConfig ?? null,
    appleLivePhoto,
  }
  const task = await window.luna.exportTask.create(
    taskName,
    entries.map((entry) => ({
      id: entry.id,
      sourcePath: entry.sourcePath,
      outputPath: entry.outputPath,
      ...(entry.role === 'apple-live' ? { label: 'Apple Live 图导出', openTarget: 'photos' as const, previewable: false } : {}),
    })),
    undefined,
    payload,
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
    void runBatchExportQueue(task.id, { ...payload, entries: queuedEntries })
      .catch((error) => failUnfinishedExportItems(task.id, error))
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

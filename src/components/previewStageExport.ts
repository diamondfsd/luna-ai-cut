import type { PreviewLayer, RenderLayer, StaticLayer } from '../shared/types'
import { buildLayers } from './PreviewStage'

const IMAGE_EXPORT_CONCURRENCY = 2
const VIDEO_EXPORT_CONCURRENCY = 1
const EXPORT_STATUS_POLL_MS = 1000

interface LunaRenderCoreApi {
  exportImageFromSources(
    outputPath: string,
    width: number,
    height: number,
    layers: PreviewLayer[],
    format: string,
    quality: number,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
  exportVideo(
    inputPath: string,
    outputPath: string,
    canvasWidth: number,
    canvasHeight: number,
    fps: number | null,
    hardware: boolean,
    videoLayer: RenderLayer,
    overlayLayers: StaticLayer[],
    taskId?: string,
    qualityPreset?: string,
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

function emitLocalExportProgress(progress: {
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

function staticLayers(layers: PreviewLayer[]): StaticLayer[] {
  return layers
    .filter((layer) => !layer.isVideo)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((layer) => ({
      imagePath: layer.filePath,
      dstX: layer.dstX,
      dstY: layer.dstY,
      dstW: layer.dstW,
      dstH: layer.dstH,
      srcX: layer.srcX ?? 0,
      srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1,
      srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
      color: layer.color,
      transform: layer.transform,
    }))
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
  await lrc().exportImageFromSources(path, params.width, params.height, params.layers, params.format, params.quality, params.exportTaskId, params.exportItemId)
  return { path, name: params.fileName }
}

export async function exportPreviewVideo(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  qualityPreset?: string
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
}): Promise<{ path: string; name: string }> {
  const videoSourceLayer = params.layers.find((layer) => layer.isVideo)
  if (!videoSourceLayer) throw new Error('未找到视频图层')

  const path = outputPath(params.exportDir, params.fileName)
  const videoLayer: RenderLayer = {
    textureId: 0,
    dstX: videoSourceLayer.dstX,
    dstY: videoSourceLayer.dstY,
    dstW: videoSourceLayer.dstW,
    dstH: videoSourceLayer.dstH,
    srcX: videoSourceLayer.srcX ?? 0,
    srcY: videoSourceLayer.srcY ?? 0,
    srcW: videoSourceLayer.srcW ?? 1,
    srcH: videoSourceLayer.srcH ?? 1,
    opacity: videoSourceLayer.opacity ?? 1,
    zIndex: videoSourceLayer.zIndex ?? 0,
    color: videoSourceLayer.color,
    transform: videoSourceLayer.transform,
  }

  await lrc().exportVideo(
    videoSourceLayer.filePath,
    path,
    params.width,
    params.height,
    null,
    true,
    videoLayer,
    staticLayers(params.layers),
    params.exportItemId,
    params.qualityPreset ?? 'high',
    params.exportTaskId,
    params.exportItemId,
  )
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
}): Promise<{ path: string; name: string }> {
  const stamp = Date.now()
  const outputDir = params.exportDir.replace(/[\\/]$/, '')
  const imagePath = `${outputDir}/${params.name}_live_image_${stamp}.jpg`
  const videoPath = `${outputDir}/${params.name}_live_video_${stamp}.mp4`

  await lrc().exportImageFromSources(imagePath, params.width, params.height, params.imageLayers, 'jpeg', 100)
  await exportPreviewVideo({
    exportDir: outputDir,
    fileName: `${params.name}_live_video_${stamp}.mp4`,
    width: params.width,
    height: params.height,
    layers: params.videoLayers,
    qualityPreset: 'high',
  })

  return window.luna.workspace.exportRenderedLivePhoto(params.name, imagePath, videoPath, params.appleLivePhoto)
}

// ── 公共批量导出 ──

export interface BatchExportSource {
  sourcePath: string
  layers?: PreviewLayer[]
  outputBaseName?: string
}

interface BatchExportEntry {
  id: string
  sourcePath: string
  outputPath: string
  layers?: PreviewLayer[]
  index: number
  kind: 'image' | 'video'
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
      if (totalFrames > 0) {
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
      const exportLayers = entry.layers ?? buildLayers(entry.sourcePath)
      const fileName = fileNameFromPath(entry.outputPath)

      if (entry.kind === 'video') {
        await exportPreviewVideo({
          exportDir,
          fileName,
          width: res.width,
          height: res.height,
          layers: exportLayers,
          qualityPreset: 'high',
          exportTaskId: taskId,
          exportItemId: entry.id,
        })
        await waitForExportItem(taskId, taskName, entry, entries.length)
        return
      }

      await exportPreviewImage({
        exportDir,
        fileName,
        width: res.width,
        height: res.height,
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
  overlayLayers: PreviewLayer[] = [],
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
    layers: entry.layers ?? (
      overlayLayers.length > 0 ? [...buildLayers(entry.sourcePath), ...overlayLayers] : undefined
    ),
  }))
  window.setTimeout(() => {
    void runBatchExportQueue(task.id, taskName, exportDir, queuedEntries)
  }, 0)

  return { taskId: task.id, items: entries.map((entry) => ({ id: entry.id, outputPath: entry.outputPath })) }
}

/** 内部：根据扩展名判断是否视频 */
function isVideoPathCached(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'].includes(ext)
}

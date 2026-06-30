import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { lunaMediaAdapter } from './deviceMedia'
import { labelsFor, localThumbnailUrl, safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import { generateThumbnail, safeId, THUMB_EXT, thumbnailDir, thumbnailPathFor } from './thumbnailService'
import { applyVideoExportSettings, applyWatermarkToImage, applyWatermarkToLivePhoto, applyWatermarkToVideo } from './watermarkService'
import { logMainInfo, logMainError, logMainWarn, logExport } from './loggerService'
import type { LunaFile, VideoExportSettings, WatermarkSettings } from '../src/shared/types'
import { createExportTask, getExportTaskById, updateTaskItemProgress } from './exportTaskService'

const EXPORT_CONCURRENCY = 3

export interface ExportProgress {
  fileName: string
  index: number
  totalFiles: number
  percent: number | null
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  destinationPath?: string
  error?: string
  exportId?: string
  taskId?: string
  taskName?: string
  createdAt?: number
}

export interface ExportSummary {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
  canceled: Array<{ name: string }>
}

function abortError(): Error {
  const error = new Error('导出已取消')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('已取消'))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

async function ensureExportThumbnail(filePath: string, fileName: string, kind: string): Promise<string | null> {
  try {
    const cacheDir = await previewCacheDir()
    const thumbDir = thumbnailDir(cacheDir)
    return await generateThumbnail(filePath, thumbDir, fileName, kind)
  } catch (error) {
    console.warn('[export] 缩略图生成失败:', fileName, error)
    return null
  }
}

function isDefaultVideoExportSettings(s?: VideoExportSettings): boolean {
  if (!s) return true
  return s.resolution === 'original' && s.frameRate === 'original' && s.quality === 'original'
}

/**
 * 并发限制器：同时最多运行 concurrency 个任务
 */
async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) return
      const index = nextIndex++
      results[index] = await handler(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export async function exportFiles(
  files: Array<{ name: string; kind: string; localPath?: string; exportId?: string; taskId?: string; taskName?: string; createdAt?: number }>,
  exportDir: string,
  watermarkSettings: WatermarkSettings,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
  videoExportSettings?: VideoExportSettings,
  onTaskCreated?: (taskId: string) => void,
): Promise<ExportSummary & { taskId?: string }> {
  const completed: ExportSummary['completed'] = []
  const failed: ExportSummary['failed'] = []
  const canceled: ExportSummary['canceled'] = []
  const tmpId = crypto.randomUUID().slice(0, 8)
  const tmpDir = path.join(exportDir, `.export_tmp_${tmpId}`)

  // 创建持久化任务记录
  const task = await createExportTask(
    files[0]?.taskName ?? (files.length === 1 ? files[0].name : `${files.length}张图片导出`),
    files.filter((f) => f.exportId).map((f) => ({
      exportId: f.exportId!,
      fileName: f.name,
      kind: f.kind,
    })),
  )
  const taskId = task.id
  onTaskCreated?.(taskId)

  logMainInfo('[EXPORT] 开始导出任务', { taskId, fileCount: files.length, exportDir, watermarkEnabled: watermarkSettings.enabled })

  await fs.mkdir(tmpDir, { recursive: true })

  function prog(file: typeof files[number], extra: Partial<ExportProgress>): ExportProgress {
    return {
      fileName: file.name,
      exportId: file.exportId,
      taskId,
      taskName: file.taskName ?? task.name,
      createdAt: file.createdAt ?? task.startTime,
      index: files.indexOf(file),
      totalFiles: files.length,
      percent: null,
      status: 'queued' as const,
      ...extra,
    }
  }

  async function processFile(file: typeof files[number]): Promise<void> {
    const itemStartTime = Date.now()

    try {
      throwIfAborted(signal)
    } catch {
      canceled.push({ name: file.name })
      logMainWarn('[EXPORT] 导出被取消', { name: file.name })
      onProgress?.(prog(file, { percent: null, status: 'canceled' }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'canceled')
      return
    }

    const localPath = file.localPath
    if (!localPath) {
      failed.push({ name: file.name, error: '文件未下载' })
      logMainError('[EXPORT] 文件导出失败', { name: file.name, error: '文件未下载' })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: '文件未下载' }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'failed', { error: '文件未下载' })
      return
    }

    try {
      await fs.access(localPath)
    } catch {
      failed.push({ name: file.name, error: '本地文件不存在' })
      logMainError('[EXPORT] 文件导出失败', { name: file.name, error: '本地文件不存在' })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: '本地文件不存在' }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'failed', { error: '本地文件不存在' })
      return
    }

    const ext = path.extname(file.name)
    const base = path.basename(file.name, ext)
    const ts = Date.now()
    const suffix = watermarkSettings.enabled ? `_wm` : ''
    const destName = `${base}${suffix}_${ts}${ext}`
    const tmpPath = path.join(tmpDir, safeName(destName))
    const finalPath = path.join(exportDir, safeName(destName))

    try {
      onProgress?.(prog(file, { percent: 0, status: 'exporting' }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'exporting')
      logMainInfo('[EXPORT] 开始处理文件', { name: file.name, kind: file.kind, localPath })

      if (file.kind === 'video' && watermarkSettings.enabled) {
        await applyWatermarkToVideo(
          localPath,
          tmpPath,
          watermarkSettings.watermarkPercent,
          watermarkSettings.position,
          watermarkSettings.style,
          (percent) => {
            onProgress?.(prog(file, { percent, status: 'exporting' }))
            void updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, percent, 'exporting')
          },
          signal,
          videoExportSettings,
        )
      } else if (file.kind === 'video' && !isDefaultVideoExportSettings(videoExportSettings)) {
        await applyVideoExportSettings(
          localPath,
          tmpPath,
          videoExportSettings!,
          (percent) => {
            onProgress?.(prog(file, { percent, status: 'exporting' }))
            void updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, percent, 'exporting')
          },
          signal,
        )
      } else if (file.kind === 'image' && watermarkSettings.enabled && /^LIV_/i.test(file.name)) {
        await applyWatermarkToLivePhoto(
          localPath,
          tmpPath,
          watermarkSettings.watermarkPercent,
          watermarkSettings.position,
          watermarkSettings.style,
          (percent) => {
            onProgress?.(prog(file, { percent, status: 'exporting' }))
            void updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, percent, 'exporting')
          },
          signal,
          videoExportSettings,
        )
      } else if (file.kind === 'image' && watermarkSettings.enabled) {
        await applyWatermarkToImage(localPath, tmpPath, watermarkSettings.watermarkPercent, watermarkSettings.position, watermarkSettings.style)
        onProgress?.(prog(file, { percent: 95, status: 'exporting' }))
        await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 95, 'exporting')
      } else {
        await fs.cp(localPath, tmpPath, { force: true })
        onProgress?.(prog(file, { percent: 95, status: 'exporting' }))
        await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 95, 'exporting')
      }
      throwIfAborted(signal)
      await fs.rename(tmpPath, finalPath)

      try {
        const outStat = await fs.stat(finalPath)
        const inStat = await fs.stat(localPath)
        logExport('INFO', '[EXPORT] 输出文件信息', {
          name: file.name,
          outputPath: finalPath,
          outputSize: outStat.size,
          inputSize: inStat.size,
          sizeRatio: inStat.size > 0 ? (outStat.size / inStat.size * 100).toFixed(1) + '%' : 'N/A',
        })
      } catch { /* 忽略 */ }

      await ensureExportThumbnail(finalPath, destName, file.kind)
      completed.push({ name: file.name, path: finalPath })
      const itemEndTime = Date.now()
      onProgress?.(prog(file, { percent: 100, status: 'done', destinationPath: finalPath }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 100, 'done', {
        endTime: itemEndTime,
        duration: itemEndTime - itemStartTime,
        destinationPath: finalPath,
      })
      logMainInfo('[EXPORT] 文件导出完成', { name: file.name, destinationPath: finalPath })
    } catch (error) {
      try { await fs.rm(tmpPath, { force: true }) } catch { /* ignore */ }
      if (signal?.aborted || isAbortError(error)) {
        canceled.push({ name: file.name })
        onProgress?.(prog(file, { percent: null, status: 'canceled' }))
        await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'canceled')
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error('[export] 导出失败:', file.name, error)
      logMainError('[EXPORT] 文件导出失败', { name: file.name, error: message })
      failed.push({ name: file.name, error: message })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: message }))
      await updateTaskItemProgress(taskId, file.exportId ?? file.name, itemStartTime, 0, 'failed', { error: message })
    }
  }

  // 使用并发池，最多 EXPORT_CONCURRENCY 个同时处理
  await asyncPool(
    files,
    EXPORT_CONCURRENCY,
    (file) => processFile(file),
    signal,
  )

  // 如果所有文件都已完成或失败，正常结束；如果有被跳过的已取消，确保任务表正确更新
  const taskAfterPool = await getExportTaskById(taskId)
  if (taskAfterPool) {
    for (let i = 0; i < taskAfterPool.items.length; i++) {
      const item = taskAfterPool.items[i]
      if (item.status === 'queued') {
        await updateTaskItemProgress(taskId, item.exportId, item.startTime ?? Date.now(), 0, 'canceled')
      }
    }
  }

  try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  return { completed, failed, canceled }
}

export async function listExportFiles(exportDir: string): Promise<LunaFile[]> {
  const files: LunaFile[] = []
  const cacheDir = await previewCacheDir()
  let thumbFileSet = new Set<string>()

  try {
    const entries = await fs.readdir(thumbnailDir(cacheDir), { withFileTypes: true })
    thumbFileSet = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  } catch {
    // No thumbnails yet.
  }

  try {
    const entries = await fs.readdir(exportDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isFile()) continue

      const filePath = path.join(exportDir, entry.name)
      const kind = lunaMediaAdapter.mediaKind(entry.name)
      if (kind === 'unknown' || kind === 'lrv') continue

      const stats = await fs.stat(filePath)
      const timestamp = lunaMediaAdapter.capturedAt(entry.name) ?? stats.mtime
      const labels = labelsFor(timestamp)
      const fileUrl = pathToFileURL(filePath).toString()
      const thumbName = `${safeId(entry.name)}${THUMB_EXT}`
      const thumbnailPath = thumbFileSet.has(thumbName)
        ? thumbnailPathFor(cacheDir, entry.name)
        : await ensureExportThumbnail(filePath, entry.name, kind)

      files.push({
        id: filePath,
        name: entry.name,
        href: entry.name,
        sourceUrl: fileUrl,
        url: fileUrl,
        dateText: labels.dateText,
        timeText: labels.timeText,
        sizeText: String(stats.size),
        bytes: stats.size,
        kind,
        extension: lunaMediaAdapter.extensionOf(entry.name),
        capturedAt: labels.capturedAt,
        groupDay: labels.groupDay,
        groupHour: labels.groupHour,
        videoKey: null,
        previewName: null,
        previewUrl: null,
        cacheFilePath: null,
        downloadFilePath: filePath,
        thumbnailUrl: thumbnailPath ? localThumbnailUrl(thumbnailPath) : null,
        isLivePhoto: false,
        livePhotoVideoName: null,
        livePhotoVideoUrl: null,
        livePhotoCacheFilePath: null,
        downloadName: entry.name,
        canPreview: kind === 'image' || kind === 'video',
        localPath: filePath,
      })
    }
  } catch {
    return []
  }

  return lunaMediaAdapter.attachRelatedFiles(files)
}

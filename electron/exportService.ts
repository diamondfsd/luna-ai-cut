import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { lunaMediaAdapter } from './deviceMedia'
import { labelsFor, localThumbnailUrl, safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import { generateThumbnail, safeId, THUMB_EXT, thumbnailDir, thumbnailPathFor } from './thumbnailService'
import { applyVideoExportSettings, applyWatermarkToImage, applyWatermarkToLivePhoto, applyWatermarkToVideo } from './watermarkService'
import type { LunaFile, VideoExportSettings, WatermarkSettings } from '../src/shared/types'

export interface ExportProgress {
  fileName: string
  index: number
  totalFiles: number
  percent: number | null
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  destinationPath?: string
  error?: string
  exportId?: string
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

export async function exportFiles(
  files: Array<{ name: string; kind: string; localPath?: string; exportId?: string }>,
  exportDir: string,
  watermarkSettings: WatermarkSettings,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
  videoExportSettings?: VideoExportSettings,
): Promise<ExportSummary> {
  const completed: ExportSummary['completed'] = []
  const failed: ExportSummary['failed'] = []
  const canceled: ExportSummary['canceled'] = []
  const exportId = crypto.randomUUID().slice(0, 8)
  const tmpDir = path.join(exportDir, `.export_tmp_${exportId}`)

  await fs.mkdir(tmpDir, { recursive: true })

  function prog(file: typeof files[number], extra: Partial<ExportProgress>): ExportProgress {
    return { fileName: file.name, exportId: file.exportId, index: files.indexOf(file), totalFiles: files.length, percent: null, status: 'queued' as const, ...extra }
  }

  for (const file of files) {
    try {
      throwIfAborted(signal)
    } catch {
      canceled.push({ name: file.name })
      onProgress?.(prog(file, { percent: null, status: 'canceled' }))
      break
    }

    const localPath = file.localPath
    if (!localPath) {
      failed.push({ name: file.name, error: '文件未下载' })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: '文件未下载' }))
      continue
    }

    try {
      await fs.access(localPath)
    } catch {
      failed.push({ name: file.name, error: '本地文件不存在' })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: '本地文件不存在' }))
      continue
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
      if (file.kind === 'video' && watermarkSettings.enabled) {
        // 有水印的视频 — 需要 ffmpeg 合成水印
        await applyWatermarkToVideo(
          localPath,
          tmpPath,
          watermarkSettings.watermarkPercent,
          watermarkSettings.position,
          watermarkSettings.style,
          (percent) => onProgress?.(prog(file, { percent, status: 'exporting' })),
          signal,
          videoExportSettings,
        )
      } else if (file.kind === 'video' && !isDefaultVideoExportSettings(videoExportSettings)) {
        // 无水印但设定了导出参数 — 需要 ffmpeg 转码
        await applyVideoExportSettings(
          localPath,
          tmpPath,
          videoExportSettings!,
          (percent) => onProgress?.(prog(file, { percent, status: 'exporting' })),
          signal,
        )
      } else if (file.kind === 'image' && watermarkSettings.enabled && /^LIV_/i.test(file.name)) {
        // Live Photo — 给图片和内嵌视频都加水印，再合并回去
        await applyWatermarkToLivePhoto(
          localPath,
          tmpPath,
          watermarkSettings.watermarkPercent,
          watermarkSettings.position,
          watermarkSettings.style,
          (percent) => onProgress?.(prog(file, { percent, status: 'exporting' })),
          signal,
          videoExportSettings,
        )
      } else if (file.kind === 'image' && watermarkSettings.enabled) {
        await applyWatermarkToImage(localPath, tmpPath, watermarkSettings.watermarkPercent, watermarkSettings.position, watermarkSettings.style)
        onProgress?.(prog(file, { percent: 95, status: 'exporting' }))
      } else {
        await fs.cp(localPath, tmpPath, { force: true })
        onProgress?.(prog(file, { percent: 95, status: 'exporting' }))
      }
      throwIfAborted(signal)
      await fs.rename(tmpPath, finalPath)
      await ensureExportThumbnail(finalPath, destName, file.kind)
      completed.push({ name: file.name, path: finalPath })
      onProgress?.(prog(file, { percent: 100, status: 'done', destinationPath: finalPath }))
    } catch (error) {
      try { await fs.rm(tmpPath, { force: true }) } catch { /* ignore */ }
      if (signal?.aborted || isAbortError(error)) {
        canceled.push({ name: file.name })
        onProgress?.(prog(file, { percent: null, status: 'canceled' }))
        break
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error('[export] 导出失败:', file.name, error)
      failed.push({ name: file.name, error: message })
      onProgress?.(prog(file, { percent: null, status: 'failed', error: message }))
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

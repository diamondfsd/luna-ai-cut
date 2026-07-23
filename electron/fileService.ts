import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { localThumbnailUrl, safeName } from './filePathUtils'
import { downloadToFile, downloadToFileWithRetry, isAbortError } from './fileDownloadService'
import { previewCacheDir } from './settingsService'
import { safeId, THUMB_EXT, thumbnailDir, thumbnailPathFor } from './thumbnailService'
import { logMainWarn } from './loggerService'
import { recordDownloadedFileSource } from './mediaSourceManifestService'
import type {
  DownloadProgress,
  DownloadSummary,
  LunaFile,
  PreviewResult,
} from '../src/shared/types'


export {
  cacheDir,
  chooseDownloadDir,
  chooseExportDir,
  chooseLocalResourcesDir,
  getLocalResourcesDir,
  chooseLutDir,
  chooseMockMediaDir,
  chooseWorkspaceMediaFiles,
  getSettings,
  previewCacheDir,
  saveSettings,
} from './settingsService'
// watermark 处理已迁移至 Rust compositor
export { getDownloadedRecords, listDownloadedFiles } from './downloadedLibraryService'
export { getMediaMetadata, getVideoFrameRate } from './mediaMetadataService'
export { clearCache, deleteLocalFiles, getCacheStats, openPath, openPhotosApp, revealFile } from './systemFileService'

// listExportFiles — moved from deleted exportService.ts
export async function listExportFiles(exportDir: string): Promise<import('../src/shared/types').LunaFile[]> {
  const { readdir, stat } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const files: import('../src/shared/types').LunaFile[] = []
  try {
    const entries = await readdir(exportDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isFile()) continue
      const fullPath = join(exportDir, entry.name)
      const s = await stat(fullPath)
      files.push({
        id: entry.name, name: entry.name, downloadName: entry.name,
        url: '', sourceUrl: '', kind: 'image',
        extension: entry.name.split('.').pop() || '',
        bytes: s.size, width: 0, height: 0,
        downloadFilePath: fullPath, localPath: fullPath,
      } as any)
    }
  } catch { /* ignore */ }
  return files
}

function partialPathFor(destination: string): string {
  return `${destination}.tmp`
}

function destinationFor(localResourcesDir: string, file: LunaFile): string {
  return path.join(localResourcesDir, safeName(file.downloadName))
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size
  } catch {
    return 0
  }
}

async function copyIfPresent(source: string, destination: string): Promise<boolean> {
  try {
    await fs.access(source)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const partialPath = partialPathFor(destination)
    await fs.rm(partialPath, { force: true })
    await fs.copyFile(source, partialPath)
    await fs.rename(partialPath, destination)
    return true
  } catch {
    return false
  }
}

function isFileUrl(url: string): boolean {
  return url.startsWith('file:')
}

function sourceUrlFor(file: LunaFile): string {
  return file.sourceUrl || file.url
}

function localPathForPreview(file: LunaFile): string | null {
  return file.downloadFilePath ?? file.localPath ?? file.cacheFilePath ?? null
}

async function extractEmbeddedLivePhotoVideo(livPath: string, destination: string): Promise<string | null> {
  const data = await fs.readFile(livPath)
  const marker = Buffer.from('ftyp', 'ascii')
  const ftypOffset = data.indexOf(marker)
  const mp4Offset = ftypOffset - 4
  if (ftypOffset < 4 || mp4Offset <= 0) return null

  const boxSize = data.readUInt32BE(mp4Offset)
  if (boxSize < 8 || boxSize > data.length - mp4Offset) return null

  await fs.mkdir(path.dirname(destination), { recursive: true })
  const partialPath = partialPathFor(destination)
  await fs.rm(partialPath, { force: true })
  await fs.writeFile(partialPath, data.subarray(mp4Offset))
  await fs.rename(partialPath, destination)
  return destination
}

function logFinalDownloadSuccess(
  file: LunaFile,
  destination: string,
  bytes: number | null | undefined,
  extra?: { copyFromUrl?: string },
): void {
  console.log('[download] 下载成功', {
    fileName: file.name,
    sourceUrl: sourceUrlFor(file),
    destination,
    bytes: bytes ?? null,
    ...(extra?.copyFromUrl ? { copyFromUrl: extra.copyFromUrl } : {}),
  })
}

function logFinalDownloadCanceled(file: LunaFile, destination: string): void {
  console.log('[download] 下载取消', {
    fileName: file.name,
    destination,
  })
}

function logFinalDownloadFailure(file: LunaFile, destination: string, error: string): void {
  console.error('[download] 下载失败', {
    fileName: file.name,
    destination,
    reason: error,
  })
}


/** 检查文件是否存在 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function previewFile(file: LunaFile): Promise<PreviewResult> {
  // 1. 优先用已下载或已缓存的本地文件
  const existingLocalPath = localPathForPreview(file)
  if (existingLocalPath && (await fileExists(existingLocalPath))) {
    return {
      fileName: file.name,
      kind: file.kind,
      source: localThumbnailUrl(existingLocalPath),
      cachedPath: existingLocalPath,
    }
  }

  // 2. 检查缓存目录
  const previewDir = await previewCacheDir()
  await fs.mkdir(previewDir, { recursive: true })
  const cachedPath = path.join(previewDir, safeName(file.name))
  if (await fileExists(cachedPath)) {
    return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(cachedPath), cachedPath }
  }
  // 视频额外检查 LRV 缓存
  if (file.kind === 'video' && file.previewName) {
    const lrvPath = path.join(previewDir, safeName(file.previewName))
    if (await fileExists(lrvPath)) {
      return { fileName: file.name, kind: file.kind, source: localThumbnailUrl(lrvPath), cachedPath: lrvPath }
    }
  }

  // 3. 本地文件直接读
  const sourceUrl = sourceUrlFor(file)
  if (isFileUrl(sourceUrl)) {
    const sourcePath = fileURLToPath(sourceUrl)
    return {
      fileName: file.name,
      kind: file.kind,
      source: localThumbnailUrl(sourcePath),
      cachedPath: sourcePath,
    }
  }

  // 4. 从相机下载到缓存
  if (file.kind === 'image') {
    await downloadToFile({ ...file, sourceUrl }, cachedPath)
    return {
      fileName: file.name,
      kind: file.kind,
      source: localThumbnailUrl(cachedPath),
      cachedPath,
    }
  }

  if (file.kind === 'video') {
    // 预览用 LRV（低分辨率代理，更快），下载才用 MP4
    const lrvItem = file.previewName && file.previewUrl
      ? { name: file.previewName, sourceUrl: file.previewUrl, bytes: null }
      : { ...file, sourceUrl }
    const lrvPath = path.join(previewDir, safeName(file.previewName ?? file.name))
    await downloadToFile(lrvItem, lrvPath)
    return {
      fileName: file.name,
      kind: file.kind,
      source: localThumbnailUrl(lrvPath),
      cachedPath: lrvPath,
    }
  }

  return {
    fileName: file.name,
    kind: file.kind,
    source: null,
    cachedPath: null,
    message: '暂不支持预览这个格式',
  }
}

/**
 * 检查文件的下载目录和已生成缩略图，设置 downloadFilePath/localPath/thumbnailUrl。
 * 不检查预览缓存、Live MP4，也不解析视频帧率；这些都由渲染层按需触发。
 *
 * 这里只做轻量文件存在性检查，避免列表初始化阶段产生大量 I/O/ffprobe/缓存工作。
 */
export async function resolveLocalThumbnails(files: LunaFile[], downloadDir: string): Promise<void> {
  if (files.length === 0) return
  const cacheDir = await previewCacheDir()

  // 一次性读取缩略图目录文件清单
  const thumbFileSet = new Set<string>()
  try {
    const thumbDirPath = thumbnailDir(cacheDir)
    const entries = await fs.readdir(thumbDirPath, { withFileTypes: true })
    for (const entry of entries) {
      thumbFileSet.add(entry.name)
    }
  } catch { /* thumbnails 目录可能还不存在 */ }

  for (const file of files) {
    // --- 下载目录中已存在 ---
    try {
      const dest = destinationFor(downloadDir, file)
      const stats = await fs.stat(dest)
      if (stats.isFile()) {
        file.localPath = dest
        file.downloadFilePath = dest
      }
    } catch { /* not in download dir */ }

    // --- 检查已生成的缩略图 ---
    const thumbName = `${safeId(file.downloadName || file.name)}${THUMB_EXT}`
    if (thumbFileSet.has(thumbName)) {
      const thumbPath = thumbnailPathFor(cacheDir, file.downloadName || file.name)
      file.thumbnailUrl = localThumbnailUrl(thumbPath)
    }
  }
}

/**
 * 下载单个文件到缓存（供懒加载使用）。
 * 返回下载后的缓存文件路径，或 null 失败。
 */
async function downloadWithLog(file: LunaFile, url: string, destPath: string): Promise<string> {
  return downloadToFile(
    { name: file.previewName ?? file.name, sourceUrl: url, bytes: file.bytes },
    destPath,
  )
}

export async function resolveExistingCache(file: LunaFile): Promise<string | null> {
  const cacheDir = await previewCacheDir()
  await fs.mkdir(cacheDir, { recursive: true })

  const toRealPath = (p: string | null | undefined): string | null => {
    if (!p) return null
    return p.startsWith('file://') ? fileURLToPath(p) : p
  }

  const existingLocalPath = localPathForPreview(file)
  const realLocalPath = toRealPath(existingLocalPath)
  if (realLocalPath && await fileExists(realLocalPath)) {
    return realLocalPath
  }

  const realCachePath = toRealPath(file.cacheFilePath)
  if (realCachePath && await fileExists(realCachePath)) {
    return realCachePath
  }

  // 检查 cache 目录：HTTP 下载后的文件存在这里
  if (file.previewName) {
    const lrvCachedPath = path.join(cacheDir, safeName(file.previewName))
    if (await fileExists(lrvCachedPath)) {
      return lrvCachedPath
    }
  }
  const cachedPath = path.join(cacheDir, safeName(file.name))
  if (await fileExists(cachedPath)) {
    return cachedPath
  }

  return null
}

export async function cacheFile(file: LunaFile): Promise<string | null> {
  try {
    // 先检查已有缓存
    const existing = await resolveExistingCache(file)
    if (existing) return existing

    const cacheDir = await previewCacheDir()
    const sourceUrl = sourceUrlFor(file)

    if (file.kind === 'video' && file.previewName && file.previewUrl) {
      const lrvPath = path.join(cacheDir, safeName(file.previewName))
      await downloadWithLog(file, file.previewUrl, lrvPath)
      return lrvPath
    }
    if (file.kind === 'video') {
      const destPath = path.join(cacheDir, safeName(file.name))
      await downloadWithLog(file, sourceUrl, destPath)
      return destPath
    }
    if (file.kind === 'image') {
      const destPath = path.join(cacheDir, safeName(file.name))
      await downloadWithLog(file, sourceUrl, destPath)
      return destPath
    }

    logMainWarn(`[cacheFile] 未知文件类型，跳过`, { fileName: file.name, kind: file.kind })
  } catch (error) {
    logMainWarn(`[cacheFile] 缓存失败`, {
      fileName: file.name,
      kind: file.kind,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
  return null
}

export async function previewLivePhoto(source: string): Promise<PreviewResult> {
  const fileName = path.basename(source.startsWith('file:') ? fileURLToPath(source) : source)
  const videoName = `${fileName}.live.mp4`
  const cacheDir = await previewCacheDir()
  await fs.mkdir(cacheDir, { recursive: true })
  const embeddedLivePath = path.join(cacheDir, `${safeName(fileName)}.live.mp4`)

  if (await fileExists(embeddedLivePath)) {
    return { fileName: videoName, kind: 'video', source: localThumbnailUrl(embeddedLivePath), cachedPath: embeddedLivePath }
  }

  const livPath = source.startsWith('file:') ? fileURLToPath(source) : source
  if (!(await fileExists(livPath))) {
    return { fileName, kind: 'image', source: null, cachedPath: null, message: 'Live 图文件不存在' }
  }

  const extractedPath = await extractEmbeddedLivePhotoVideo(livPath, embeddedLivePath)
  if (!extractedPath) {
    return { fileName, kind: 'image', source: null, cachedPath: null, message: '没有在 Live 图中找到视频片段' }
  }

  return { fileName: videoName, kind: 'video', source: localThumbnailUrl(extractedPath), cachedPath: extractedPath }
}

export async function downloadFiles(
  files: LunaFile[],
  outputDir: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { completed: [], failed: [], canceled: [] }
  await fs.mkdir(outputDir, { recursive: true })

  for (const [index, file] of files.entries()) {
    if (signal?.aborted) {
      summary.canceled.push({ name: file.name })
      break
    }

    const destination = destinationFor(outputDir, file)
    try {
      const existingFinal = await fileSize(destination)
      if (existingFinal > 0) {
        await recordDownloadedFileSource(outputDir, destination, file)
        onProgress({
          fileName: file.name,
          index,
          totalFiles: files.length,
          downloaded: existingFinal,
          total: existingFinal,
          percent: 100,
          speedBps: 0,
          status: 'done',
          destinationPath: destination,
        })
        summary.completed.push({ name: file.name, path: destination })
        logFinalDownloadSuccess(file, destination, existingFinal)
        continue
      }

      // 只复用同名原文件缓存；LRV/代理缓存不能作为正式下载文件。
      const previewDir = await previewCacheDir()
      const cachedPath = file.cacheFilePath ?? path.join(previewDir, safeName(file.name))
      const canCopyCachedFile = path.basename(cachedPath) === safeName(file.downloadName)
      if (canCopyCachedFile && await copyIfPresent(cachedPath, destination)) {
        await recordDownloadedFileSource(outputDir, destination, file)
        onProgress({
          fileName: file.name,
          index,
          totalFiles: files.length,
          downloaded: file.bytes ?? 0,
          total: file.bytes,
          percent: 100,
          speedBps: 0,
          status: 'done',
          destinationPath: destination,
        })
        summary.completed.push({ name: file.name, path: destination })
        logFinalDownloadSuccess(file, destination, file.bytes, { copyFromUrl: cachedPath })
        continue
      }

      await downloadToFileWithRetry({ ...file, sourceUrl: sourceUrlFor(file) }, destination, (progress) => {
        onProgress({
          ...progress,
          index,
          totalFiles: files.length,
          status: 'downloading',
        })
      }, signal)

      onProgress({
        fileName: file.name,
        index,
        totalFiles: files.length,
        downloaded: file.bytes ?? 0,
        total: file.bytes,
        percent: 100,
        speedBps: 0,
        status: 'done',
        destinationPath: destination,
      })
      await recordDownloadedFileSource(outputDir, destination, file)
      summary.completed.push({ name: file.name, path: destination })
      logFinalDownloadSuccess(file, destination, file.bytes)
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        const partialSize = await fileSize(partialPathFor(destination))
        onProgress({
          fileName: file.name,
          index,
          totalFiles: files.length,
          downloaded: partialSize,
          total: file.bytes,
          percent: file.bytes ? Math.min(100, (partialSize / file.bytes) * 100) : null,
          speedBps: 0,
          status: 'canceled',
        })
        summary.canceled.push({ name: file.name })
        logFinalDownloadCanceled(file, destination)
        break
      }

      const message = error instanceof Error ? error.message : String(error)
      logFinalDownloadFailure(file, destination, message)
      onProgress({
        fileName: file.name,
        index,
        totalFiles: files.length,
        downloaded: 0,
        total: file.bytes,
        percent: null,
        speedBps: 0,
        status: 'failed',
      })
      summary.failed.push({ name: file.name, error: message })
    }
  }

  return summary
}

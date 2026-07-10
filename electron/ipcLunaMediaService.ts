import { ipcMain } from 'electron'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DownloadProgress, LunaFile } from '../src/shared/types'
import {
  cacheFile,
  deleteLocalFiles,
  downloadFiles,
  getLocalResourcesDir,
  getMediaMetadata,
  getSettings,
  getVideoFrameRate,
  listDownloadedFiles,
  listExportFiles,
  openPath,
  openPhotosApp,
  previewCacheDir,
  previewFile,
  previewLivePhoto,
  resolveLocalThumbnails,
  revealFile,
} from './fileService'
import type { IpcContext } from './ipcContext'
import { listSampleFiles } from './localMedia'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from './loggerService'
import { enqueueThumbnailGeneration, thumbnailDir } from './thumbnailService'

function mediaKindForPath(filePath: string): LunaFile['kind'] {
  const ext = path.extname(filePath).toLowerCase()
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.m4v', '.lrv'].includes(ext)) return 'video'
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic', '.heif', '.avif'].includes(ext)) return 'image'
  return 'unknown'
}

function localFileForPath(filePath: string): LunaFile {
  const name = path.basename(filePath)
  return {
    id: filePath,
    name,
    href: filePath,
    sourceUrl: filePath,
    url: filePath,
    dateText: '',
    timeText: '',
    sizeText: '',
    bytes: null,
    kind: mediaKindForPath(filePath),
    extension: path.extname(filePath),
    capturedAt: null,
    groupDay: '',
    groupHour: '',
    videoKey: null,
    previewName: null,
    previewUrl: null,
    cacheFilePath: null,
    downloadFilePath: filePath,
    thumbnailUrl: null,
    isLivePhoto: false,
    livePhotoVideoName: null,
    livePhotoVideoUrl: null,
    livePhotoCacheFilePath: null,
    downloadName: name,
    canPreview: true,
    localPath: filePath,
  }
}

export function register(ctx: IpcContext): void {
  ipcMain.handle('luna:cacheFile', async (_event, params: string | { sourceUrl: string; previewUrl?: string | null }) => {
    // 兼容旧格式（直接传 sourceUrl 字符串）
    const sourceUrl = typeof params === 'string' ? params : params.sourceUrl
    const previewUrl = typeof params === 'string' ? undefined : params.previewUrl
    const key = sourceUrl
    const existingTask = ctx.previewCacheTasks.get(key)
    if (existingTask) {
      logMainDebug(`[缓存] 缓存任务已存在，复用`, { key })
      return existingTask
    }

    const file = localFileForPath(sourceUrl)
    // 如果传入了 previewUrl，设置到 file 上以便 cacheFile 优先使用 LRV 下载
    if (previewUrl) {
      try {
        file.previewName = new URL(previewUrl).pathname.split('/').pop() ?? previewUrl
      } catch {
        file.previewName = previewUrl.replace(/^.*[/\\]/, '')
      }
      file.previewUrl = previewUrl
    }

    logMainInfo(`[缓存] 开始缓存文件`, { key, fileName: file.name, kind: file.kind })

    const task = ctx.enqueuePreviewTask(async () => {
      let cacheFilePath: string | null = null
      try {
        cacheFilePath = await cacheFile(file)
        if (cacheFilePath) {
          const cacheDir = await previewCacheDir()
          const thumbDir = thumbnailDir(cacheDir)
          const thumbnailKey = file.downloadName || file.name
          const thumbPath = await enqueueThumbnailGeneration(cacheFilePath, thumbDir, thumbnailKey, file.kind, file.name)
          if (thumbPath) {
            const thumbnailUrl = pathToFileURL(thumbPath).toString()
            ctx.win?.webContents.send('luna:thumbnail-ready', {
              fileId: file.id,
              fileName: file.name,
              downloadName: file.downloadName,
              cacheFilePath,
              thumbnailUrl,
            })
          } else {
            logMainWarn(`[缓存] 缩略图生成失败，清理损坏的缓存文件`, { key, fileName: file.name, cacheFilePath })
            await rm(cacheFilePath, { force: true, maxRetries: 3 }).catch(() => {})
            ctx.win?.webContents.send('luna:thumbnail-ready', {
              fileId: file.id,
              fileName: file.name,
              downloadName: file.downloadName,
              cacheFilePath: null,
              thumbnailUrl: null,
            })
          }
        }
        if (!cacheFilePath) {
          logMainWarn(`[缓存] 缓存文件失败`, { key, fileName: file.name })
        }
        return cacheFilePath !== null
      } catch (err) {
        logMainError(`[缓存] 缓存任务异常`, {
          key,
          fileName: file.name,
          kind: file.kind,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        return false
      }
    }, 0).finally(() => {
      ctx.previewCacheTasks.delete(key)
    })
    ctx.previewCacheTasks.set(key, task)
    return task
  })

  ipcMain.handle('luna:requestVideoFrameRate', async (_event, file: LunaFile, cachedPath?: string | null) => {
    const sourcePath = cachedPath ?? file.downloadFilePath ?? file.localPath ?? null
    const key = `${file.id || file.name}:${sourcePath ?? ''}`
    const existingTask = ctx.videoFrameRateTasks.get(key)
    if (existingTask) return existingTask

    const task = ctx.enqueuePreviewTask(async () => {
      const result = await getVideoFrameRate(file, sourcePath)
      if (result.frameRate !== null || result.duration !== null) {
        ctx.win?.webContents.send('luna:video-frame-rate-ready', {
          fileId: file.id,
          fileName: file.name,
          frameRate: result.frameRate,
          duration: result.duration,
        })
      }
      return result.frameRate
    }, 0).finally(() => {
      ctx.videoFrameRateTasks.delete(key)
    })
    ctx.videoFrameRateTasks.set(key, task)
    return task
  })

  ipcMain.handle('luna:readExifModel', async (_event, localPath: string) => {
    const { readExifModel } = await import('./exifReader')
    return readExifModel(localPath)
  })

  ipcMain.handle('luna:getWatermarkPath', async (_event, style: string, kind: 'image' | 'video') => {
    const { watermarkFileFor } = await import('./watermarkAssets')
    const { nativeImage } = await import('electron')
    const filePath = watermarkFileFor(kind, style)
    const img = nativeImage.createFromPath(filePath)
    const size = img.getSize()
    return { filePath, width: size.width, height: size.height }
  })

  ipcMain.handle('luna:listSampleFiles', async () => {
    const settings = await getSettings()
    return listSampleFiles(settings.mockMediaDir)
  })

  ipcMain.handle('downloads:listFiles', async (_event, _downloadDir?: string) => {
    const settings = await getSettings()
    const resolvedDir = getLocalResourcesDir(settings)
    logMainInfo('[下载列表] 读取目录', { resolvedDir, localResourcesDir: settings.localResourcesDir, downloadDir: settings.downloadDir })
    const files = await listDownloadedFiles(resolvedDir)
    if (resolvedDir) {
      await resolveLocalThumbnails(files, resolvedDir)
    }
    return files
  })

  ipcMain.handle('exports:listFiles', async (_event, exportDir?: string) => {
    const settings = await getSettings()
    const resolvedDir = exportDir || settings.exportDir || ''
    if (!resolvedDir) return []
    return listExportFiles(resolvedDir)
  })

  ipcMain.handle('luna:resolveThumbnail', async (_event, filePath: string, kind?: string) => {
    const cacheDir = await previewCacheDir()
    const thumbDir = thumbnailDir(cacheDir)
    const fileId = path.basename(filePath).replace(path.extname(filePath), '')
    const thumbPath = await enqueueThumbnailGeneration(filePath, thumbDir, fileId, kind, path.basename(filePath))
    return thumbPath ? pathToFileURL(thumbPath).toString() : null
  })

  ipcMain.handle('luna:previewFile', async (_event, file: LunaFile) => {
    return ctx.enqueuePreviewTask(async () => {
      await ctx.ensureCameraSessionForFile(file)
      return previewFile(file)
    }, 2)
  })

  ipcMain.handle('luna:previewLivePhoto', async (_event, sourceUrl: string) => {
    return ctx.enqueuePreviewTask(async () => {
      return previewLivePhoto(sourceUrl)
    }, 2)
  })

  ipcMain.handle('luna:metadata', async (_event, file: LunaFile, cachedPath?: string | null) => {
    return ctx.enqueuePreviewTask(async () => {
      await ctx.ensureCameraSessionForFile(file)
      return getMediaMetadata(file, cachedPath)
    }, 1)
  })

  ipcMain.handle('luna:metadataByPath', async (_event, filePath: string) => {
    return ctx.enqueuePreviewTask(async () => {
      return getMediaMetadata(localFileForPath(filePath), filePath)
    }, 1)
  })

  ipcMain.handle('files:reveal', (_event, filePath: string) => revealFile(filePath))
  ipcMain.handle('files:openPath', (_event, targetPath: string) => openPath(targetPath))
  ipcMain.handle('files:openPhotosApp', async () => openPhotosApp())
  ipcMain.handle('files:deleteLocal', (_event, filePaths: string[]) => deleteLocalFiles(filePaths))

  ipcMain.handle('luna:downloadFiles', async (_event, files: LunaFile[], _downloadDir?: string) => {
    const settings = await getSettings()
    logMainInfo(`[下载] 开始下载文件`, { fileCount: files.length, fileNames: files.map((file) => file.name).slice(0, 5).join(', ') + (files.length > 5 ? `...(+${files.length - 5})` : '') })
    await ctx.prepareDownloadSession(files, settings)

    const controller = new AbortController()
    ctx.activeDownloadControllers.add(controller)
    try {
      return await downloadFiles(files, getLocalResourcesDir(settings), (progress: DownloadProgress) => {
        ctx.win?.webContents.send('download:progress', progress)
      }, controller.signal)
    } finally {
      ctx.activeDownloadControllers.delete(controller)
    }
  })
}

import { app, dialog, ipcMain, nativeImage, type OpenDialogOptions } from 'electron'
import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { DownloadProgress, LunaFile } from '../../src/shared/types'
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
  resolveExistingCache,
  resolveLocalThumbnails,
  revealFile,
} from '../storage/fileService'
import type { IpcContext } from './context'
import { listSampleFiles } from '../media/localMedia'
import { logMainError, logMainInfo, logMainWarn } from '../infrastructure/loggerService'
import { enqueueThumbnailGeneration, thumbnailDir } from '../media/thumbnailService'
import { detectInsta360ILog } from '../media/iLogDetection'
import { existingDragFiles } from '../platform/files/nativeFileDragService'
import { copyLocalFilesToDirectory, sourcePathsForCopy } from '../media/localFileCopyService'

function mediaKindForPath(filePath: string): LunaFile['kind'] {
  const ext = path.extname(mediaFileNameForPath(filePath)).toLowerCase()
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.m4v', '.lrv', '.lrf', '.xrf'].includes(ext)) return 'video'
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic', '.heif', '.avif'].includes(ext)) return 'image'
  return 'unknown'
}

/**
 * 相机媒体地址通常统一指向 /v2，真实文件名放在 path 查询参数中。
 * 代理视频（LRV/LRF）也依赖这个名字来确定缓存文件和缩略图 key。
 */
function mediaFileNameForPath(filePath: string): string {
  try {
    if (/^(?:https?|file):/i.test(filePath)) {
      const url = new URL(filePath)
      const mediaPath = url.searchParams.get('path')
      if (mediaPath) return path.basename(mediaPath)
      return path.basename(decodeURIComponent(url.pathname))
    }
  } catch {
    // 回退到普通本地路径解析。
  }
  return path.basename(filePath.split(/[?#]/, 1)[0])
}

/** LRV 文件的缩略图 key 映射为对应的 MP4 文件名，避免不同格式重复生成缩略图 */
function thumbnailKeyFor(file: LunaFile): string {
  const base = file.downloadName || file.name
  // LRV_xxx.lrv → VID_xxx.mp4（与下载时的 downloadName 一致）
  if (/^LRV_(.+)\.lrv$/i.test(base)) {
    return base.replace(/^LRV_/i, 'VID_').replace(/\.lrv$/i, '.mp4')
  }
  return base
}

function localFileForPath(filePath: string): LunaFile {
  const name = mediaFileNameForPath(filePath)
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
    extension: path.extname(name),
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
    rawCompanion: null,
    canPreview: true,
    localPath: filePath,
  }
}

function localSourcePath(sourceUrl: string): string | null {
  if (sourceUrl.startsWith('file:')) {
    try { return fileURLToPath(sourceUrl) } catch { return sourceUrl }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(sourceUrl) && !/^[a-z]:[\\/]/i.test(sourceUrl)) return null
  return sourceUrl
}

const MAX_DRAG_ICON_SIZE = 96

function resizeDragIcon(image: Electron.NativeImage): Electron.NativeImage {
  if (image.isEmpty()) return image
  const { width, height } = image.getSize()
  const scale = Math.min(1, MAX_DRAG_ICON_SIZE / Math.max(width, height))
  if (scale === 1) return image
  return image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
}

function dragThumbnailPath(thumbnailUrl: unknown): string | null {
  if (typeof thumbnailUrl !== 'string') return null
  if (thumbnailUrl.startsWith('file:')) {
    try {
      return fileURLToPath(thumbnailUrl)
    } catch {
      return null
    }
  }
  return path.isAbsolute(thumbnailUrl) ? thumbnailUrl : null
}

function dragIcon(files: string[], thumbnailUrl: unknown): Electron.NativeImage {
  const thumbnailPath = dragThumbnailPath(thumbnailUrl)
  const thumbnail = thumbnailPath ? nativeImage.createFromPath(thumbnailPath) : nativeImage.createEmpty()
  if (!thumbnail.isEmpty()) return resizeDragIcon(thumbnail)

  const sourceImage = nativeImage.createFromPath(files[0])
  if (!sourceImage.isEmpty()) return resizeDragIcon(sourceImage)

  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png')
  return resizeDragIcon(nativeImage.createFromPath(appIconPath))
}

export function register(ctx: IpcContext): void {
  ipcMain.on('files:start-drag', (event, requestedPaths: unknown, requestedThumbnailUrl: unknown) => {
    const files = existingDragFiles(requestedPaths)
    if (files.length === 0) return
    event.sender.startDrag({ file: files[0], files, icon: dragIcon(files, requestedThumbnailUrl) })
  })
  ipcMain.handle('files:copy-to-directory', async (_event, filePaths: unknown) => {
    const sourcePaths = sourcePathsForCopy(filePaths)
    if (sourcePaths.length === 0) throw new Error('请先选择素材')
    const options: OpenDialogOptions = {
      title: '选择复制目标文件夹',
      properties: ['openDirectory', 'createDirectory'],
    }
    const parentWindow = ctx.win
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return copyLocalFilesToDirectory(sourcePaths, result.filePaths[0])
  })
  ipcMain.handle('luna:cacheFile', async (_event, params: string | { sourceUrl: string; previewUrl?: string | null }) => {
    // 兼容旧格式（直接传 sourceUrl 字符串）
    const sourceUrl = typeof params === 'string' ? params : params.sourceUrl
    const previewUrl = typeof params === 'string' ? undefined : params.previewUrl
    const key = sourceUrl
    const existingTask = ctx.previewCacheTasks.get(key)
    if (existingTask) {
      return existingTask
    }

    const file = localFileForPath(sourceUrl)
    // 如果传入了 previewUrl，设置到 file 上以便 cacheFile 优先使用 LRV 下载
    if (previewUrl) {
      file.previewName = mediaFileNameForPath(previewUrl)
      file.previewUrl = previewUrl
    }

    // 先用标记占位，防止并发调用重复检查
    const marker = Promise.resolve(true)
    ctx.previewCacheTasks.set(key, marker)

    try {
      const sourcePath = localSourcePath(sourceUrl)
      if (sourcePath) {
        try {
          await access(sourcePath)
        } catch {
          ctx.previewCacheTasks.delete(key)
          return false
        }
      }

      // 快速检查：已有缓存则直接返回，不进入下载队列
      const existingPath = await resolveExistingCache(file)
      if (existingPath) {
        const cacheDir = await previewCacheDir()
        const thumbDir = thumbnailDir(cacheDir)
        const thumbnailKey = thumbnailKeyFor(file)
        const thumbPath = await enqueueThumbnailGeneration(existingPath, thumbDir, thumbnailKey, file.kind, file.name)
        ctx.win?.webContents.send('luna:thumbnail-ready', {
          fileId: file.id,
          fileName: file.name,
          downloadName: file.downloadName,
          cacheFilePath: existingPath,
          thumbnailUrl: thumbPath ? pathToFileURL(thumbPath).toString() : null,
        })
        ctx.previewCacheTasks.delete(key)
        return true
      }

      // 无缓存，入队下载（受并发限制）
      const task = ctx.enqueuePreviewTask(async () => {
        let cacheFilePath: string | null = null
        try {
          cacheFilePath = await cacheFile(file)
          if (cacheFilePath) {
            const cacheDir = await previewCacheDir()
            const thumbDir = thumbnailDir(cacheDir)
            const thumbnailKey = thumbnailKeyFor(file)
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
    } catch (err) {
      ctx.previewCacheTasks.delete(key)
      throw err
    }
  })

  ipcMain.handle('luna:requestVideoFrameRate', async (_event, file: LunaFile, cachedPath?: string | null) => {
    const sourcePath = cachedPath ?? file.downloadFilePath ?? file.localPath ?? null
    const key = `${file.id || file.name}:${sourcePath ?? ''}`
    const existingTask = ctx.videoFrameRateTasks.get(key)
    if (existingTask) return existingTask

    const task = ctx.enqueuePreviewTask(async () => {
      const result = await getVideoFrameRate(file, sourcePath)
      if (result.frameRate !== null || result.duration !== null || result.dolbyVision !== null || result.iLog !== null) {
        ctx.win?.webContents.send('luna:video-frame-rate-ready', {
          fileId: file.id,
          fileName: file.name,
          frameRate: result.frameRate,
          duration: result.duration,
          dolbyVision: result.dolbyVision,
          dolbyVisionProfile: result.dolbyVisionProfile,
          iLog: result.iLog,
        })
      }
      return result.frameRate
    }, 0).finally(() => {
      ctx.videoFrameRateTasks.delete(key)
    })
    ctx.videoFrameRateTasks.set(key, task)
    return task
  })

  ipcMain.handle('luna:detectILog', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || mediaKindForPath(filePath) !== 'video') return false
    return detectInsta360ILog(filePath)
  })

  ipcMain.handle('luna:readExifModel', async (_event, localPath: string) => {
    const { readExifModel } = await import('../media/exifReader')
    return readExifModel(localPath)
  })

  ipcMain.handle('luna:getWatermarkPath', async (_event, style: string, kind: 'image' | 'video') => {
    const { watermarkFileFor } = await import('../export/watermarkAssets')
    const { nativeImage } = await import('electron')
    const filePath = watermarkFileFor(kind, style)
    const img = nativeImage.createFromPath(filePath)
    const size = img.getSize()
    return { filePath, width: size.width, height: size.height }
  })

  ipcMain.handle('luna:getBorderLogoPath', async (_event, logoId: string) => {
    const names: Record<string, string> = {
      logo_standard_black: 'luna_ultra_logo_blank.png',
      logo_standard_white: 'luna_ultra_logo_white.png',
      logo_cn_black: 'luna_ultra_logo_cn_blank.png',
      logo_cn_white: 'luna_ultra_logo_cn_white.png',
    }
    const fileName = names[logoId]
    if (!fileName) throw new Error('未知边框标志')
    return app.isPackaged
      ? path.join(process.resourcesPath, 'logos', fileName)
      : path.join(app.getAppPath(), 'src', 'assets', 'logos', fileName)
  })

  ipcMain.handle('luna:listSampleFiles', async () => {
    const settings = await getSettings()
    return listSampleFiles(settings.mockMediaDir)
  })

  ipcMain.handle('downloads:listFiles', async () => {
    const settings = await getSettings()
    const resolvedDir = getLocalResourcesDir(settings)
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
      await ctx.ensureCameraSessionForFile(file, undefined, cachedPath)
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

  ipcMain.handle('luna:downloadFiles', async (_event, files: LunaFile[]) => {
    const settings = await getSettings()
    const localResourcesDir = getLocalResourcesDir(settings)
    logMainInfo(`[下载] 开始下载文件`, { fileCount: files.length, fileNames: files.map((file) => file.name).slice(0, 5).join(', ') + (files.length > 5 ? `...(+${files.length - 5})` : '') })

    const controller = new AbortController()
    ctx.activeDownloadControllers.add(controller)
    const task = downloadFiles(files, localResourcesDir, (progress: DownloadProgress) => {
      ctx.win?.webContents.send('download:progress', progress)
    }, controller.signal, settings.organizeDownloadsByDate ?? false)
    ctx.activeDownloadTasks.add(task)
    try {
      return await task
    } finally {
      ctx.activeDownloadControllers.delete(controller)
      ctx.activeDownloadTasks.delete(task)
    }
  })

  ipcMain.handle('luna:cancelDownloads', async () => {
    const controllers = [...ctx.activeDownloadControllers]
    const tasks = [...ctx.activeDownloadTasks]
    logMainInfo('[下载] 收到取消请求', {
      activeControllerCount: controllers.length,
      activeTaskCount: tasks.length,
    })
    for (const controller of controllers) controller.abort()
    const results = await Promise.allSettled(tasks)
    logMainInfo('[下载] 取消请求处理完成', {
      activeControllerCount: ctx.activeDownloadControllers.size,
      activeTaskCount: ctx.activeDownloadTasks.size,
      rejectedTaskCount: results.filter((result) => result.status === 'rejected').length,
    })
  })
}

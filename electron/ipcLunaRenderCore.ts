/**
 * IPC 处理器 — Luna Render Core
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureInit,
  loadTexture as lrcLoadTexture,
  loadTextureFromPath as lrcLoadTextureFromPath,
  updateTexture as lrcUpdateTexture,
  releaseTexture as lrcReleaseTexture,
  renderFrame as lrcRenderFrame,
  renderPreview as lrcRenderPreview,
  renderLayersToFile as lrcRenderLayersToFile,
  resolveRenderSource as lrcResolveRenderSource,
  exportImageFromSources as lrcExportImageFromSources,
  exportFileAsync as lrcExportFileAsync,
  cancelExportTask as lrcCancelExportTask,
  getExportTaskProgress as lrcGetExportTaskProgress,
  destroy as lrcDestroy,
} from './lunaRenderCore'
import { dialog } from 'electron'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'

interface RegisterContext {
  win: Electron.BrowserWindow | null
}

interface PreviewLayerArg {
  filePath: string
  isVideo?: boolean
  videoTime?: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

interface RenderLayerArg {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

interface StaticLayerArg {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const appRoot = process.env.APP_ROOT || join(import.meta.dirname, '..')
  const logPath = join(appRoot, 'luna-render-core', 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: any[]) => any>(label: string, fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      throw err
    }
  }) as unknown as T
}

function normalizeInputPath(inputPath: string): string {
  return inputPath.startsWith('file:') ? fileURLToPath(inputPath) : inputPath
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'export.mp4'
}

export function register(_ctx: RegisterContext): void {
  // 打开文件选择对话框，返回文件路径
  ipcMain.handle('lrc:pickVideo', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择视频文件',
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'insv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    ensureInit(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:loadTexture', safe('loadTexture',
    async (_event: IpcMainInvokeEvent, data: Buffer, width: number, height: number) => {
      const id = lrcLoadTexture(data, width, height)
      rcLog(`lrc:loadTexture -> id=${id} ${width}x${height}`)
      return id
    },
  ))

  ipcMain.handle('lrc:loadTextureFromPath', safe('loadTextureFromPath',
    async (_event: IpcMainInvokeEvent, path: string, maxSize: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const result = lrcLoadTextureFromPath(ffmpegPath, ffprobePath, path, maxSize)
      rcLog(`lrc:loadTextureFromPath -> id=${result.textureId} ${result.width}x${result.height} (maxSize=${maxSize})`)
      return result
    },
  ))

  ipcMain.handle('lrc:updateTexture', safe('updateTexture',
    async (_event: IpcMainInvokeEvent, textureId: number, data: Buffer) => {
      lrcUpdateTexture(textureId, data)
    },
  ))

  ipcMain.handle('lrc:releaseTexture', safe('releaseTexture',
    async (_event: IpcMainInvokeEvent, textureId: number) => {
      lrcReleaseTexture(textureId)
      rcLog(`lrc:releaseTexture id=${textureId}`)
    },
  ))

  ipcMain.handle('lrc:renderFrame', safe('renderFrame',
    async (
      _event: IpcMainInvokeEvent,
      canvasWidth: number,
      canvasHeight: number,
      layers: RenderLayerArg[],
    ) => {
      return lrcRenderFrame(canvasWidth, canvasHeight, layers)
    },
  ))

  ipcMain.handle('lrc:renderPreview', safe('renderPreview',
    async (_event: IpcMainInvokeEvent, input: any) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderPreview({ ...input, ffmpegPath, ffprobePath })
    },
  ))

  ipcMain.handle('lrc:exportImageFromSources', safe('exportImageFromSources',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      width: number,
      height: number,
      layers: PreviewLayerArg[],
      format: string,
      quality: number,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:exportImageFromSources out=${outputPath} ${width}x${height} layers=${layers.length} fmt=${format}`)
      lrcExportImageFromSources(ffmpegPath, ffprobePath, outputPath, width, height, layers, format, quality)
      rcLog('lrc:exportImageFromSources done')
    },
  ))

  ipcMain.handle('lrc:resolveRenderSource', safe('resolveRenderSource',
    async (_event: IpcMainInvokeEvent, originalPath: string, cacheDir: string) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:resolveRenderSource path=${originalPath}`)
      return lrcResolveRenderSource(ffmpegPath, ffprobePath, originalPath, cacheDir)
    },
  ))

  ipcMain.handle('lrc:renderLayersToFile', safe('renderLayersToFile',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      width: number,
      height: number,
      layers: RenderLayerArg[],
      format: string,
      quality: number,
    ) => {
      const ffmpegPath = getFfmpegPath()
      rcLog(`lrc:renderLayersToFile out=${outputPath} ${width}x${height} layers=${layers.length} fmt=${format}`)
      lrcRenderLayersToFile(ffmpegPath, outputPath, width, height, layers, format, quality)
      rcLog('lrc:renderLayersToFile done')
    },
  ))

  ipcMain.handle('lrc:exportVideo', safe('exportVideo',
    async (
      _event: IpcMainInvokeEvent,
      inputPath: string,
      outputPath: string,
      canvasWidth: number,
      canvasHeight: number,
      fps: number | null,
      hardware: boolean,
      videoLayer: RenderLayerArg,
      overlayLayers: StaticLayerArg[],
      taskId?: string,
      qualityPreset?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const sourcePath = normalizeInputPath(inputPath)
      const exportId = taskId ?? `lrc_${Date.now()}`
      const fileName = fileNameFromPath(outputPath)
      rcLog(`lrc:exportVideo start f=${ffmpegPath} p=${ffprobePath} ${sourcePath} → ${outputPath} task=${exportId} qp=${qualityPreset}`)
      _ctx.win?.webContents.send('export:progress', {
        exportId,
        fileName,
        percent: 0,
        status: 'exporting',
        destinationPath: outputPath,
      })
      lrcExportFileAsync(ffmpegPath, ffprobePath, sourcePath, outputPath, canvasWidth, canvasHeight, fps, hardware, videoLayer, overlayLayers, exportId, qualityPreset)
        .then(() => {
          rcLog(`lrc:exportVideo done out=${outputPath}`)
          _ctx.win?.webContents.send('export:progress', {
            exportId,
            fileName,
            percent: 100,
            status: 'done',
            destinationPath: outputPath,
          })
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err)
          rcLog(`ERROR in exportVideo async: ${error} out=${outputPath}`)
          _ctx.win?.webContents.send('export:progress', {
            exportId,
            fileName,
            percent: 100,
            status: 'failed',
            destinationPath: outputPath,
            error,
          })
        })
      return { outputPath, exportId }
    },
  ))

  ipcMain.handle('lrc:cancelExportTask', safe('cancelExportTask',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      lrcCancelExportTask(taskId)
      rcLog(`lrc:cancelExportTask task=${taskId}`)
    },
  ))

  ipcMain.handle('lrc:getExportTaskProgress', safe('getExportTaskProgress',
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      return lrcGetExportTaskProgress(taskId)
    },
  ))

  ipcMain.handle('lrc:destroy', async () => {
    lrcDestroy()
  })
}

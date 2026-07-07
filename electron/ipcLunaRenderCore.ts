/**
 * IPC 处理器 — Luna Render Core
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureInit,
  renderCompositionFrame as lrcRenderCompositionFrame,
  resolveRenderSource as lrcResolveRenderSource,
  exportCompositionVideoAsync as lrcExportCompositionVideoAsync,
  exportCompositionImageAsync as lrcExportCompositionImageAsync,
  cancelExportTask as lrcCancelExportTask,
  getExportTaskProgress as lrcGetExportTaskProgress,
  loadLut as lrcLoadLut,
  releaseLut as lrcReleaseLut,
} from './lunaRenderCore'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import * as exportTaskService from './exportTaskService'

interface RegisterContext {
  win: Electron.BrowserWindow | null
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

export function register(_ctx: RegisterContext): void {
  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    ensureInit(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:renderCompositionFrame', safe('renderCompositionFrame',
    async (_event: IpcMainInvokeEvent, composition: any, time: number, maxSide?: number) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      return lrcRenderCompositionFrame(ffmpegPath, ffprobePath, composition, time, maxSide)
    },
  ))

  ipcMain.handle('lrc:exportCompositionImage', safe('exportCompositionImage',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      format: string,
      quality: number,
      exportTaskId?: string,
      exportItemId?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:exportCompositionImage out=${outputPath} fmt=${format} q=${quality}`)

      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
      }
      _event.sender?.send('export:progress', {
        exportId: exportItemId,
        taskId: exportTaskId,
        fileName: outputPath.split(/[\\/]/).pop(),
        percent: 0,
        status: 'exporting',
        destinationPath: outputPath,
      })

      await lrcExportCompositionImageAsync({ ffmpegPath, ffprobePath, outputPath, composition, format, quality })

      _event.sender?.send('export:progress', {
        exportId: exportItemId,
        taskId: exportTaskId,
        fileName: outputPath.split(/[\\/]/).pop(),
        percent: 100,
        status: 'done',
        destinationPath: outputPath,
      })

      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
      }
      rcLog('lrc:exportCompositionImage done')
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

  ipcMain.handle('lrc:exportCompositionVideo', safe('exportCompositionVideo',
    async (
      _event: IpcMainInvokeEvent,
      outputPath: string,
      composition: any,
      fps: number | null,
      duration: number | null,
      hardware: boolean,
      taskId?: string,
      qualityPreset?: string,
      exportTaskId?: string,
      exportItemId?: string,
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      const renderTaskId = taskId ?? exportItemId ?? `composition_${Date.now()}`
      const progressExportId = exportItemId ?? renderTaskId
      const fileName = fileNameFromPath(outputPath)
      rcLog(`lrc:exportCompositionVideo start out=${outputPath} task=${renderTaskId} layers=${composition?.layers?.length ?? 0}`)
      if (exportTaskId && exportItemId) {
        await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting' }).catch(() => {})
      }
      _event.sender?.send('export:progress', {
        exportId: progressExportId,
        taskId: exportTaskId,
        fileName,
        percent: 0,
        status: 'exporting',
        destinationPath: outputPath,
      })
      const progressTimer = setInterval(() => {
        const progress = lrcGetExportTaskProgress(renderTaskId)
        if (!progress) return
        const currentFrame = Number(progress[0])
        const totalFrames = Number(progress[1])
        if (totalFrames <= 1) return
        const percent = Math.max(0, Math.min(99, Math.floor((currentFrame / totalFrames) * 100)))
        if (exportTaskId && exportItemId) {
          exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'exporting', progress: percent }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent,
          status: 'exporting',
          destinationPath: outputPath,
        })
      }, 500)
      try {
        await lrcExportCompositionVideoAsync({
          ffmpegPath,
          ffprobePath,
          outputPath,
          composition,
          fps,
          duration,
          hardware,
          taskId: renderTaskId,
          qualityPreset,
        })
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'done', progress: 100, destinationPath: outputPath }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 100,
          status: 'done',
          destinationPath: outputPath,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (exportTaskId && exportItemId) {
          await exportTaskService.updateItem(exportTaskId, exportItemId, { status: 'failed', error: message }).catch(() => {})
        }
        _event.sender?.send('export:progress', {
          exportId: progressExportId,
          taskId: exportTaskId,
          fileName,
          percent: 100,
          status: 'failed',
          destinationPath: outputPath,
          error: message,
        })
        throw error
      } finally {
        clearInterval(progressTimer)
      }
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

  ipcMain.handle('lrc:loadLut', safe('loadLut',
    async (_event: IpcMainInvokeEvent, cubeData: Buffer) => {
      return lrcLoadLut(cubeData)
    },
  ))

  ipcMain.handle('lrc:releaseLut', safe('releaseLut',
    async (_event: IpcMainInvokeEvent, lutId: number) => {
      lrcReleaseLut(lutId)
    },
  ))
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'export.mp4'
}

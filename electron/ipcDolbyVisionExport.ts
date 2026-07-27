import { ipcMain } from 'electron'
import path from 'node:path'
import type { DolbyVisionWatermarkExportRequest } from '../src/shared/types'
import type { IpcContext } from './ipcContext'
import * as exportTaskService from './exportTaskService'
import { exportDolbyVisionWatermark, probeDolbyVision } from './dolbyVisionExportService'

export function register(ctx: IpcContext): void {
  ipcMain.handle('workspace:probeDolbyVision', (_event, filePath: string) => probeDolbyVision(filePath))

  ipcMain.handle('workspace:exportDolbyVisionWatermark', async (event, request: DolbyVisionWatermarkExportRequest) => {
    const controller = new AbortController()
    const previous = ctx.activeExportControllers.get(request.exportTaskId)
    if (previous) throw new Error('该导出任务正在运行')
    ctx.activeExportControllers.set(request.exportTaskId, controller)
    const sendProgress = async (percent: number, status: 'exporting' | 'done' | 'failed' | 'canceled', error?: string) => {
      await exportTaskService.updateItem(request.exportTaskId, request.exportItemId, {
        status, progress: percent, destinationPath: request.outputPath, error,
      }).catch(() => {})
      event.sender.send('export:progress', {
        exportId: request.exportItemId,
        taskId: request.exportTaskId,
        fileName: path.basename(request.outputPath),
        percent,
        status,
        destinationPath: request.outputPath,
        error,
      })
    }
    try {
      await sendProgress(0, 'exporting')
      await exportDolbyVisionWatermark(request, {
        signal: controller.signal,
        onProgress: (percent) => { void sendProgress(percent, 'exporting') },
      })
      await sendProgress(100, 'done')
      return { path: request.outputPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await sendProgress(100, controller.signal.aborted ? 'canceled' : 'failed', message)
      throw error
    } finally {
      ctx.activeExportControllers.delete(request.exportTaskId)
    }
  })
}

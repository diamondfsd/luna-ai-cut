import { ipcMain } from 'electron'
import path from 'node:path'
import type { DolbyVisionWatermarkExportRequest } from '../../src/shared/types'
import type { IpcContext } from './context'
import * as exportTaskService from '../export/exportTaskService'
import { exportDolbyVisionWatermark, probeDolbyVision } from '../export/dolbyVisionExportService'
import { fileOperationErrorDetails, friendlyFileOperationError, userFacingFileOperationError } from '../storage/fileOperationDiagnostics.ts'
import { logMainError } from '../infrastructure/loggerService'

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
      const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const message = canceled ? (error instanceof Error ? error.message : String(error)) : friendlyFileOperationError(error, 'export')
      if (!canceled) {
        logMainError('[export] Dolby Vision 导出失败', {
          sourcePath: request.sourcePath,
          outputPath: request.outputPath,
          temporaryPathPattern: `${request.outputPath}.partial-*`,
          userMessage: message,
          ...fileOperationErrorDetails(error, request.outputPath),
        })
      }
      await sendProgress(100, canceled ? 'canceled' : 'failed', message)
      throw canceled ? error : userFacingFileOperationError(error, 'export')
    } finally {
      ctx.activeExportControllers.delete(request.exportTaskId)
    }
  })
}

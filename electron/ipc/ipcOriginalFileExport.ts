import { ipcMain } from 'electron'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import type { OriginalFileExportRequest } from '../../src/shared/types'
import * as exportTaskService from '../export/exportTaskService'
import type { IpcContext } from './context'
import { exportOriginalFile } from '../export/originalFileExportService'
import { fileOperationErrorDetails, friendlyFileOperationError, userFacingFileOperationError } from '../storage/fileOperationDiagnostics.ts'
import { logMainError, logMainInfo } from '../infrastructure/loggerService'

export function register(ctx: IpcContext): void {
  ipcMain.handle('workspace:exportOriginalFile', async (event, request: OriginalFileExportRequest) => {
    const controller = new AbortController()
    const controllerKey = `${request.exportTaskId}:${request.exportItemId}`
    if (ctx.activeExportControllers.has(controllerKey)) throw new Error('该导出项目正在运行')
    ctx.activeExportControllers.set(controllerKey, controller)

    const sendProgress = async (
      percent: number,
      status: 'exporting' | 'done' | 'failed' | 'canceled',
      error?: string,
    ) => {
      await exportTaskService.updateItem(request.exportTaskId, request.exportItemId, {
        status,
        progress: percent,
        destinationPath: request.outputPath,
        error,
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
      await exportOriginalFile(request.sourcePath, request.outputPath, controller.signal)
      const task = await exportTaskService.getTask(request.exportTaskId)
      const itemCanceled = task?.items.find((item) => item.id === request.exportItemId)?.status === 'canceled'
      if (controller.signal.aborted || itemCanceled) {
        await rm(request.outputPath, { force: true })
        const error = new Error('导出已取消')
        error.name = 'AbortError'
        throw error
      }
      await sendProgress(100, 'done')
      logMainInfo('[export] 原片导出成功', {
        sourcePath: request.sourcePath,
        outputPath: request.outputPath,
      })
      return { path: request.outputPath }
    } catch (error) {
      const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const message = canceled ? (error instanceof Error ? error.message : String(error)) : friendlyFileOperationError(error, 'export')
      if (!canceled) {
        logMainError('[export] 原片导出失败', {
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
      ctx.activeExportControllers.delete(controllerKey)
    }
  })
}

import { ipcMain } from 'electron'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import type { OriginalFileExportRequest } from '../src/shared/types'
import * as exportTaskService from './exportTaskService'
import type { IpcContext } from './ipcContext'
import { exportOriginalFile } from './originalFileExportService'

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
      return { path: request.outputPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      await sendProgress(100, canceled ? 'canceled' : 'failed', message)
      throw error
    } finally {
      ctx.activeExportControllers.delete(controllerKey)
    }
  })
}

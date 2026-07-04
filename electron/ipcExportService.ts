import { ipcMain } from 'electron'
import type { ExportFileInput, VideoExportSettings, WatermarkSettings } from '../src/shared/types'
import { clearExportTasks, getExportTaskById, getExportTasks, updateTaskItemProgress } from './exportTaskService'
import { exportFiles } from './fileService'
import type { IpcContext } from './ipcContext'

export function register(ctx: IpcContext): void {
  ipcMain.handle('luna:exportFiles', (_event, files: ExportFileInput[], exportDir: string, watermarkSettings: WatermarkSettings, videoExportSettings?: VideoExportSettings) => {
    const controller = new AbortController()
    const callKey = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    ctx.activeExportControllers.set(callKey, controller)
    const resultPromise = exportFiles(files, exportDir, watermarkSettings, (progress) => {
      ctx.win?.webContents.send('export:progress', progress)
    }, controller.signal, videoExportSettings, (taskId) => {
      ctx.activeExportControllers.delete(callKey)
      ctx.activeExportControllers.set(taskId, controller)
    })
    resultPromise.finally(() => {
      for (const [key, ctrl] of ctx.activeExportControllers) {
        if (ctrl === controller) ctx.activeExportControllers.delete(key)
      }
    })
    return resultPromise
  })

  ipcMain.handle('luna:cancelExports', () => {
    for (const [, controller] of ctx.activeExportControllers) {
      controller.abort()
    }
    ctx.activeExportControllers.clear()
  })

  ipcMain.handle('luna:cancelExportTask', async (_event, taskId: string) => {
    const controller = ctx.activeExportControllers.get(taskId)
    if (controller) {
      controller.abort()
      ctx.activeExportControllers.delete(taskId)
    }
    const task = await getExportTaskById(taskId)
    if (task) {
      for (const item of task.items) {
        if (item.status === 'queued' || item.status === 'exporting') {
          await updateTaskItemProgress(taskId, item.exportId, item.startTime ?? Date.now(), 0, 'canceled')
        }
      }
    }
  })

  ipcMain.handle('exports:getTasks', async () => {
    return getExportTasks()
  })

  ipcMain.handle('exports:getTask', async (_event, taskId: string) => {
    return getExportTaskById(taskId)
  })

  ipcMain.handle('exports:clearTasks', async () => {
    await clearExportTasks()
  })
}

/**
 * ipcExportTask.ts — 导出任务记录 IPC 通道
 *
 * 统一暴露给前端的任务记录 CRUD 接口。
 * 前端的 export:progress 事件由 WebGPU 导出流程负责，
 * 此处只处理持久化任务的增删改查。
 */
import { ipcMain } from 'electron'
import * as exportTaskService from './exportTaskService'
import type { ExportItemInput, ExportItemUpdate } from '../src/shared/types/export'
import type { IpcContext } from './ipcContext'

export function register(ctx: IpcContext): void {
  // 应用启动时加载已有任务记录
  exportTaskService.loadTasks()

  // ── 创建任务 ──
  ipcMain.handle(
    'export-task:create',
    async (_event, name: string, items?: ExportItemInput[], taskId?: string) => {
      return exportTaskService.createTask(name, items, taskId)
    },
  )

  // ── 追加子任务 ──
  ipcMain.handle(
    'export-task:add-items',
    async (_event, taskId: string, items: ExportItemInput[]) => {
      await exportTaskService.addItems(taskId, items)
    },
  )

  // ── 更新子任务进度/状态 ──
  ipcMain.handle(
    'export-task:update-item',
    async (_event, taskId: string, itemId: string, data: ExportItemUpdate) => {
      await exportTaskService.updateItem(taskId, itemId, data)
    },
  )

  // ── 取消任务 ──
  ipcMain.handle('export-task:cancel', async (_event, taskId: string) => {
    for (const [key, controller] of ctx.activeExportControllers) {
      if (key === taskId || key.startsWith(`${taskId}:`)) controller.abort()
    }
    await exportTaskService.cancelTask(taskId)
  })

  // ── 查询单个任务 ──
  ipcMain.handle(
    'export-task:get',
    async (_event, taskId: string) => {
      return exportTaskService.getTask(taskId)
    },
  )

  // ── 查询所有任务 ──
  ipcMain.handle('export-task:list', async () => {
    return exportTaskService.getTasks()
  })

  // ── 清空任务 ──
  ipcMain.handle('export-task:clear', async () => {
    await exportTaskService.clearTasks()
  })
}

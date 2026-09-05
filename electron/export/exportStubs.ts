/** 旧导出兼容 stub — workspace 导出后续统一改造为 Native Core */
import type { ExportTaskRecord, ExportTaskItemRecord, ExportTaskItem } from '../../src/shared/types'

const tasks = new Map<string, ExportTaskRecord>()

export async function createExportTask(name: string, items: Array<{ exportId: string; fileName: string; kind: string }>, taskId?: string): Promise<ExportTaskRecord> {
  const now = Date.now()
  const t: ExportTaskRecord = {
    id: taskId || `t_${now}`,
    name, startTime: now, endTime: null, duration: null,
    totalCount: items.length, progress: 0, status: 'pending',
    items: items.map((item) => ({
      id: item.exportId,
      fileName: item.fileName, kind: item.kind as ExportTaskItem['kind'],
      startTime: now, endTime: null, duration: null,
      progress: 0, status: 'queued' as const,
    })),
  }
  tasks.set(t.id, t)
  return t
}

export async function getExportTaskById(taskId: string): Promise<ExportTaskRecord | undefined> { return tasks.get(taskId) }

export async function updateTaskItemProgress(
  taskId: string, exportId: string,
  progress: number, status: ExportTaskItemRecord['status'],
): Promise<void> {
  const t = tasks.get(taskId); if (!t) return
  const item = t.items.find((i) => i.id === exportId); if (!item) return
  item.progress = progress; item.status = status
}

export async function addTaskItem(taskId: string, item: { exportId: string; fileName: string; kind: string }): Promise<void> {
  const t = tasks.get(taskId); if (!t) return
  t.items.push({ id: item.exportId, fileName: item.fileName, kind: item.kind as ExportTaskItem['kind'], startTime: Date.now(), endTime: null, duration: null, progress: 0, status: 'queued' })
  t.totalCount = t.items.length
}

export async function getExportTasks(): Promise<ExportTaskRecord[]> { return [...tasks.values()] }
export async function clearExportTasks(): Promise<void> { tasks.clear() }

// ── exportJobService stub ──
import type { WebContents } from 'electron'
import type { ExportProgress } from '../../src/shared/types'

export interface ExportJobItem<T extends string = string> {
  exportId: string; fileName: string; kind: string; type: T
}

export interface ExportJobContext<T extends string = string> {
  task: ExportTaskRecord
  updateItem: (item: ExportJobItem<T>, progress: number, status: ExportTaskItemRecord['status'], extra?: Record<string, unknown>) => Promise<void>
}

export async function runExportJob<T extends string>(
  taskName: string, items: ExportJobItem<T>[],
  sender: WebContents | undefined,
  worker: (ctx: ExportJobContext<T>) => Promise<void>,
): Promise<ExportTaskRecord> {
  const task = await createExportTask(taskName, items)
  for (const item of items) {
    if (!sender || sender.isDestroyed()) continue
    const payload: ExportProgress = {
      exportId: item.exportId, fileName: item.fileName,
      index: 0, totalFiles: task.totalCount, percent: 0, status: 'queued',
      taskId: task.id, taskName: task.name,
    }
    sender.send('export:progress', payload)
  }
  const updateItem: ExportJobContext<T>['updateItem'] = async (item, progress, status, extra) => {
    await updateTaskItemProgress(task.id, item.exportId, progress, status)
    if (sender && !sender.isDestroyed()) {
      sender.send('export:progress', {
        exportId: item.exportId, fileName: item.fileName,
        index: 0, totalFiles: task.totalCount,
        percent: status === 'failed' || status === 'canceled' ? null : progress,
        status, taskId: task.id, taskName: task.name,
        destinationPath: typeof extra?.destinationPath === 'string' ? extra.destinationPath : undefined,
        error: typeof extra?.error === 'string' ? extra.error : undefined,
      })
    }
  }
  await worker({ task, updateItem })
  return task
}

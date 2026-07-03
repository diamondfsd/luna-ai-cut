import type { WebContents } from 'electron'

import type { ExportProgress, ExportTaskItemRecord, ExportTaskRecord } from '../src/shared/types'
import { createExportTask, updateTaskItemProgress } from './exportTaskService'

export interface ExportJobItem<T extends string = string> {
  exportId: string
  fileName: string
  kind: string
  type: T
}

interface ExportJobUpdateExtra {
  destinationPath?: string
  error?: string
}

export interface ExportJobContext<T extends string = string> {
  task: ExportTaskRecord
  updateItem: (
    item: ExportJobItem<T>,
    progress: number,
    status: ExportTaskItemRecord['status'],
    extra?: ExportJobUpdateExtra,
  ) => Promise<void>
}

function emitProgress<T extends string>(
  sender: WebContents | undefined,
  task: ExportTaskRecord,
  item: ExportJobItem<T>,
  progress: number,
  status: ExportTaskItemRecord['status'],
  extra?: ExportJobUpdateExtra,
): void {
  if (!sender || sender.isDestroyed()) return
  const index = task.items.findIndex((taskItem) => taskItem.exportId === item.exportId)
  const payload: ExportProgress = {
    exportId: item.exportId,
    taskId: task.id,
    taskName: task.name,
    createdAt: task.startTime,
    fileName: item.fileName,
    index: Math.max(0, index),
    totalFiles: task.totalCount,
    percent: status === 'failed' || status === 'canceled' ? null : progress,
    status,
    destinationPath: extra?.destinationPath,
    error: extra?.error,
  }
  sender.send('export:progress', payload)
}

export async function runExportJob<T extends string>(
  taskName: string,
  items: Array<ExportJobItem<T>>,
  sender: WebContents | undefined,
  worker: (context: ExportJobContext<T>) => Promise<void>,
): Promise<ExportTaskRecord> {
  const task = await createExportTask(taskName, items)

  for (const item of items) {
    emitProgress(sender, task, item, 0, 'queued')
  }

  const updateItem: ExportJobContext<T>['updateItem'] = async (item, progress, status, extra) => {
    const now = Date.now()
    const taskItem = task.items.find((candidate) => candidate.exportId === item.exportId)
    const startTime = taskItem?.startTime ?? now
    await updateTaskItemProgress(task.id, item.exportId, startTime, progress, status, {
      endTime: status === 'done' || status === 'failed' || status === 'canceled' ? now : undefined,
      duration: status === 'done' || status === 'failed' || status === 'canceled' ? now - startTime : undefined,
      destinationPath: extra?.destinationPath,
      error: extra?.error,
    })
    emitProgress(sender, task, item, progress, status, extra)
  }

  await worker({ task, updateItem })
  return task
}

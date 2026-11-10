import type { ExportTaskPayload } from '../shared/types'

export async function failUnfinishedExportItems(taskId: string, error: unknown): Promise<void> {
  try {
    const task = await window.luna.exportTask.get(taskId)
    const message = error instanceof Error ? error.message : String(error)
    await Promise.all((task?.items ?? [])
      .filter((item) => item.status === 'queued' || item.status === 'exporting')
      .map((item) => window.luna.exportTask.updateItem(taskId, item.id, { status: 'failed', error: message }).catch(() => {})))
  } catch (updateError) {
    console.error('[ExportTaskRecovery] failed to update task status', updateError)
  }
}

/** 恢复任务先由主进程原子领取，再按保存的执行快照启动对应导出器。 */
export async function resumeExportTask(taskId: string): Promise<boolean> {
  const claimed = await window.luna.exportTask.beginResume(taskId)
  if (!claimed) return false

  const run = async (payload: ExportTaskPayload): Promise<void> => {
    if (payload.kind === 'local-media') {
      const { resumeLocalMediaExportTask } = await import('../components/localMediaExportQueue')
      await resumeLocalMediaExportTask(taskId, payload)
      return
    }
    const { resumeWorkspaceMixedExportTask } = await import('../workspace/shared/workspaceMixedExport')
    await resumeWorkspaceMixedExportTask(taskId, payload)
  }

  window.setTimeout(() => {
    void run(claimed.payload).catch((error) => failUnfinishedExportItems(taskId, error))
  }, 0)
  return true
}

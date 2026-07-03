/**
 * exportTaskRunner.ts — 通用导出任务调度
 *
 * 统一管理导出任务的创建、并发调度（图片 4 路、视频 1 路）、进度跟踪。
 * 媒体库和工作台共用此函数，避免重复实现。
 */
import { useCallback } from 'react'

import { useApp } from '../context/AppContext'
import type { ExportProgress } from '../shared/types'

/** 单个导出项定义 */
export interface ExportTaskItem {
  exportId: string
  fileName: string
  kind: 'image' | 'video'
  /** 执行导出，返回结果路径 */
  execute: (context: { taskId: string }) => Promise<{ path: string; name: string }>
}

/** runExportTask 返回值 */
export interface ExportTaskResult {
  completed: Array<{ name: string; path: string }>
  failed: Array<{ name: string; error: string }>
}

/** 带并发限制的异步 map */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

/**
 * 通用导出任务调度 Hook
 *
 * 用法：
 * ```ts
 * const { runExportTask } = useExportTaskRunner()
 *
 * const result = await runExportTask({
 *   taskName: '批量导出 5 个文件',
 *   items: files.map(f => ({
 *     exportId: f.id,
 *     fileName: f.name,
 *     kind: f.kind,
 *     execute: async ({ taskId }) => {
 *       return window.luna.workspace.exportFFmpeg(f.path, pipeline, {
 *         exportId: f.id, taskName: '...', taskId,
 *         fileName: f.name, index: 0, totalFiles: files.length,
 *       })
 *     },
 *   })),
 *   onProgressInit: (initItems) => {
 *     // 可选：设置初始进度状态
 *   },
 * })
 * ```
 */
export function useExportTaskRunner() {
  const { setExportProgress, setExporting } = useApp()

  const runExportTask = useCallback(async (options: {
    taskName: string
    items: ExportTaskItem[]
    /** 创建任务后的回调，用于设置初始 snapshot / progress */
    onProgressInit?: (items: Array<{ exportId: string; taskId: string; fileName: string; kind: string }>) => void
  }): Promise<ExportTaskResult> => {
    const { taskName, items } = options
    if (items.length === 0) return { completed: [], failed: [] }

    setExporting(true)

    // 1. 创建任务（所有明细一次写入）
    const task = await window.luna.workspace.createExportTask(
      taskName,
      items.map((i) => ({ exportId: i.exportId, fileName: i.fileName, kind: i.kind })),
    )

    // 2. 初始 queued 状态
    const ts = Date.now()
    const initProgress = new Map<string, ExportProgress>()
    for (const item of items) {
      initProgress.set(item.exportId, {
        exportId: item.exportId,
        taskId: task.id,
        taskName,
        createdAt: ts,
        fileName: item.fileName,
        index: 0,
        totalFiles: items.length,
        percent: 0,
        status: 'queued',
      })
    }
    setExportProgress((current) => new Map([...current, ...initProgress]))

    // 3. 通知调用方（设置 snapshot 等）
    options.onProgressInit?.(items.map((i) => ({
      exportId: i.exportId, taskId: task.id, fileName: i.fileName, kind: i.kind,
    })))

    // 4. 并发调度
    const completed: ExportTaskResult['completed'] = []
    const failed: ExportTaskResult['failed'] = []

    const exportOne = async (item: ExportTaskItem) => {
      setExportProgress((current) => new Map(current).set(item.exportId, {
        ...current.get(item.exportId)!,
        status: 'exporting' as const,
      }))
      try {
        const result = await item.execute({ taskId: task.id })
        completed.push({ name: item.fileName, path: result.path })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failed.push({ name: item.fileName, error: message })
        setExportProgress((current) => new Map(current).set(item.exportId, {
          ...current.get(item.exportId)!,
          status: 'failed' as const,
          error: message,
        }))
      }
    }

    const imageItems = items.filter((i) => i.kind !== 'video')
    const videoItems = items.filter((i) => i.kind === 'video')

    await Promise.all([
      runWithConcurrency(imageItems, 4, exportOne),
      runWithConcurrency(videoItems, 1, exportOne),
    ])

    setExporting(false)
    return { completed, failed }
  }, [setExportProgress, setExporting])

  return { runExportTask }
}

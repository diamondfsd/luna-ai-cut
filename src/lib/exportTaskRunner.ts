/**
 * exportTaskRunner.ts — 通用导出任务调度
 *
 * 统一管理导出任务的创建、并发调度（图片 4 路、视频 1 路）、进度跟踪。
 * 媒体库和工作台共用此函数，避免重复实现。
 */
import { useCallback } from 'react'

import { useExportProgress } from '../context/ExportProgressContext'
import type { ExportProgress } from '../shared/types'

/** 单个导出项定义 */
export interface ExportTaskItem {
  id: string
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
 *     id: f.id,
 *     sourcePath: f.path,
 *     outputPath: outputPath,
 *   })),
 * })
 * ```
 */
export function useExportTaskRunner() {
  const { setExportProgress, setExporting } = useExportProgress()

  const runExportTask = useCallback(async (options: {
    taskName: string
    items: ExportTaskItem[]
    /** 创建任务后的回调，用于设置初始 snapshot / progress */
    onProgressInit?: (items: Array<{ exportId: string; taskId: string; fileName: string; kind: string }>) => void
  }): Promise<ExportTaskResult> => {
    const { taskName, items } = options
    if (items.length === 0) return { completed: [], failed: [] }

    setExporting(true)

    // 1. 创建任务（通过统一 exportTask API）
    const task = await window.luna.exportTask.create(
      taskName,
      items.map((i) => ({ id: i.id, sourcePath: `file://${i.fileName}`, outputPath: `file://${i.fileName}` })),
    )

    // 2. 初始 queued 状态（前端实时进度）
    const ts = Date.now()
    const initProgress = new Map<string, ExportProgress>()
    for (const item of items) {
      initProgress.set(item.id, {
        exportId: item.id,
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
      exportId: i.id, taskId: task.id, fileName: i.fileName, kind: i.kind,
    })))

    // 4. 并发调度
    const completed: ExportTaskResult['completed'] = []
    const failed: ExportTaskResult['failed'] = []

    const exportOne = async (item: ExportTaskItem) => {
      setExportProgress((current) => new Map(current).set(item.id, {
        ...current.get(item.id)!,
        status: 'exporting' as const,
      }))
      try {
        const result = await item.execute({ taskId: task.id })
        completed.push({ name: item.fileName, path: result.path })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failed.push({ name: item.fileName, error: message })
        setExportProgress((current) => new Map(current).set(item.id, {
          ...current.get(item.id)!,
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

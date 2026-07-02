import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'

import type { ExportTaskItemRecord, ExportTaskRecord } from '../src/shared/types'

const TASKS_FILE = 'export-tasks.json'
const MAX_TASKS = 100

let tasksDir: string | null = null

// 互斥锁，防止并发读写 JSON 文件导致竞态
let mutexQueue: Array<() => void> = []
let mutexLocked = false

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (mutexLocked) {
    await new Promise<void>((resolve) => mutexQueue.push(resolve))
  }
  mutexLocked = true
  try {
    return await fn()
  } finally {
    if (mutexQueue.length > 0) {
      const next = mutexQueue.shift()
      next!() // 唤醒下一个等待者，它自己会设 mutexLocked = true
    } else {
      mutexLocked = false
    }
  }
}

async function getTasksDir(): Promise<string> {
  if (tasksDir) return tasksDir
  const userData = app.getPath('userData')
  tasksDir = path.join(userData, 'export-tasks')
  await fs.mkdir(tasksDir, { recursive: true })
  return tasksDir
}

async function readTasks(): Promise<ExportTaskRecord[]> {
  try {
    const dir = await getTasksDir()
    const filePath = path.join(dir, TASKS_FILE)
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

async function writeTasks(tasks: ExportTaskRecord[]): Promise<void> {
  const dir = await getTasksDir()
  const filePath = path.join(dir, TASKS_FILE)
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf-8')
}

/**
 * 创建一个新的导出任务，并写入持久化存储
 */
export async function createExportTask(
  name: string,
  items: Array<{ exportId: string; fileName: string; kind: string }>,
): Promise<ExportTaskRecord> {
  return withLock(async () => {
    const tasks = await readTasks()
    const now = Date.now()
    const task: ExportTaskRecord = {
      id: `export_task_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      totalCount: items.length,
      startTime: now,
      endTime: null,
      duration: null,
      progress: 0,
      status: 'exporting',
      items: items.map((item) => ({
        exportId: item.exportId,
        fileName: item.fileName,
        kind: item.kind,
        startTime: null,
        endTime: null,
        duration: null,
        progress: 0,
        status: 'queued',
      })),
    }
    tasks.unshift(task)
    const trimmed = tasks.slice(0, MAX_TASKS)
    await writeTasks(trimmed)
    return task
  })
}

/**
 * 更新任务中某个明细项的状态
 */
export async function updateTaskItem(
  taskId: string,
  exportId: string,
  update: Partial<ExportTaskItemRecord>,
): Promise<ExportTaskRecord | null> {
  return withLock(async () => {
    const tasks = await readTasks()
    const taskIndex = tasks.findIndex((t) => t.id === taskId)
    if (taskIndex === -1) return null
    const task = tasks[taskIndex]
    const itemIndex = task.items.findIndex((item) => item.exportId === exportId)
    if (itemIndex === -1) return null
    task.items[itemIndex] = { ...task.items[itemIndex], ...update }

    // 重新计算任务进度
    const doneItems = task.items.filter((item) => item.status === 'done').length
    const failedItems = task.items.filter((item) => item.status === 'failed').length
    const canceledItems = task.items.filter((item) => item.status === 'canceled').length
    const totalProgress = task.items.reduce((sum, item) => {
      if (item.status === 'done') return sum + 100
      if (item.status === 'failed' || item.status === 'canceled') return sum
      return sum + item.progress
    }, 0)
    task.progress = task.totalCount > 0 ? Math.round(totalProgress / task.totalCount) : 0

    // 判断任务状态
    const allFinished = doneItems + failedItems + canceledItems === task.totalCount
    if (allFinished) {
      task.endTime = Date.now()
      task.duration = task.endTime - task.startTime
      task.progress = 100
      if (failedItems > 0 && doneItems === 0) {
        task.status = 'failed'
      } else if (canceledItems === task.totalCount) {
        task.status = 'canceled'
      } else {
        task.status = 'completed'
      }
    }

    tasks[taskIndex] = task
    await writeTasks(tasks)
    return task
  })
}

/**
 * 更新任务中某个明细项的进度
 */
export async function updateTaskItemProgress(
  taskId: string,
  exportId: string,
  startTime: number | null,
  progress: number,
  status: ExportTaskItemRecord['status'],
  extra?: { endTime?: number; duration?: number; destinationPath?: string; error?: string },
): Promise<void> {
  const update: Partial<ExportTaskItemRecord> = { progress, status }
  if (startTime !== null) update.startTime = startTime
  if (extra?.endTime !== undefined) update.endTime = extra.endTime
  if (extra?.duration !== undefined) update.duration = extra.duration
  if (extra?.destinationPath !== undefined) update.destinationPath = extra.destinationPath
  if (extra?.error !== undefined) update.error = extra.error
  await updateTaskItem(taskId, exportId, update)
}

/**
 * 获取所有导出任务
 */
export async function getExportTasks(): Promise<ExportTaskRecord[]> {
  return readTasks()
}

/**
 * 根据 ID 获取单个导出任务
 */
export async function getExportTaskById(taskId: string): Promise<ExportTaskRecord | null> {
  const tasks = await readTasks()
  return tasks.find((t) => t.id === taskId) ?? null
}

/**
 * 清空所有导出任务
 */
export async function clearExportTasks(): Promise<void> {
  const dir = await getTasksDir()
  const filePath = path.join(dir, TASKS_FILE)
  await fs.writeFile(filePath, '[]', 'utf-8')
}

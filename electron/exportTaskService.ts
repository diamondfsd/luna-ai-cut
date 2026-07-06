/**
 * exportTaskService.ts — 导出任务记录服务
 *
 * 职责：
 * - 任务 CRUD（创建/追加/更新/查询/取消）
 * - JSON 文件持久化（userData/.luna-cache/export-tasks.json）
 * - 父任务自动聚合（recalcTask）
 *
 * ExportItemInput 只需 { id, sourcePath, outputPath }，
 * fileName/kind/destinationPath 由 service 自动推断。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { ExportTaskRecord, ExportTaskItem, ExportItemUpdate, ExportItemInput } from '../src/shared/types/export'

// ── 常量 ──

const CACHE_DIR = '.luna-cache'
const FILE_NAME = 'export-tasks.json'
const MAX_TASKS = 200
const PRUNE_DAYS = 30
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv'])

// ── 内存状态 ──

let tasks: ExportTaskRecord[] = []
let loaded = false

// ── 文件路径 ──

function filePath(): string {
  const dir = join(app.getPath('userData'), CACHE_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, FILE_NAME)
}

// ── 持久化 ──

/** 从 JSON 文件加载到内存 */
export function loadTasks(): void {
  if (loaded) return
  const path = filePath()
  if (!existsSync(path)) {
    tasks = []
    loaded = true
    return
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    tasks = (parsed.tasks ?? []) as ExportTaskRecord[]
  } catch {
    tasks = []
  }
  loaded = true
}

/** 内存状态写回 JSON 文件 */
function saveTasks(): void {
  const path = filePath()
  writeFileSync(path, JSON.stringify({ version: 1, tasks }, null, 2), 'utf-8')
}

// ── 工具 ──

function now(): number {
  return Date.now()
}

function generateId(): string {
  return `t_${now()}_${Math.random().toString(36).slice(2, 6)}`
}

function inferKind(outputPath: string): ExportTaskItem['kind'] {
  const ext = extname(outputPath).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image'
}

function isTerminalStatus(status: ExportTaskItem['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'canceled'
}

function inputToItem(input: ExportItemInput, ts: number): ExportTaskItem {
  return {
    id: input.id,
    fileName: basename(input.outputPath),
    kind: inferKind(input.outputPath),
    destinationPath: input.outputPath,
    status: 'queued' as const,
    progress: 0,
    startTime: ts,
    endTime: null,
    duration: null,
  }
}

// ── 核心 CRUD ──

/**
 * 创建新任务
 * @param name 任务名称
 * @param items 子任务列表（只需 id / sourcePath / outputPath）
 * @param taskId 可选的外部 taskId（不传则自动生成）
 */
export async function createTask(
  name: string,
  items?: ExportItemInput[],
  taskId?: string,
): Promise<ExportTaskRecord> {
  loadTasks()
  const id = taskId ?? generateId()
  const ts = now()
  const task: ExportTaskRecord = {
    id,
    name,
    totalCount: items?.length ?? 0,
    status: 'pending',
    progress: 0,
    startTime: ts,
    endTime: null,
    duration: null,
    items: (items ?? []).map((item) => inputToItem(item, ts)),
  }
  tasks.unshift(task)
  saveTasks()
  return task
}

/**
 * 向已有任务追加子任务
 */
export async function addItems(taskId: string, items: ExportItemInput[]): Promise<void> {
  loadTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error(`任务 ${taskId} 不存在`)
  const ts = now()
  for (const item of items) {
    task.items.push(inputToItem(item, ts))
  }
  task.totalCount = task.items.length
  recalcTask(task)
  saveTasks()
}

/**
 * 更新子任务进度/状态
 * 自动 recalcTask 聚合父任务
 */
export async function updateItem(
  taskId: string,
  itemId: string,
  data: ExportItemUpdate,
): Promise<void> {
  loadTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return
  const item = task.items.find((i) => i.id === itemId)
  if (!item) return

  if (isTerminalStatus(item.status) && data.status === 'exporting') {
    return
  }

  if (data.status !== undefined) item.status = data.status
  if (data.progress !== undefined) item.progress = data.progress
  if (data.error !== undefined) item.error = data.error
  if (data.destinationPath !== undefined) item.destinationPath = data.destinationPath

  // 状态变更时更新时间
  if (data.status === 'exporting' && item.startTime === 0) {
    item.startTime = now()
  }
  if (data.status === 'done' || data.status === 'failed' || data.status === 'canceled') {
    item.endTime = now()
    item.duration = item.endTime! - item.startTime
  }

  recalcTask(task)
  saveTasks()
}

/**
 * 取消整个任务（将所有 queued/exporting 的子项标记为 canceled）
 */
export async function cancelTask(taskId: string): Promise<void> {
  loadTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return
  const ts = now()
  for (const item of task.items) {
    if (item.status === 'queued' || item.status === 'exporting') {
      item.status = 'canceled'
      item.endTime = ts
      item.duration = ts - item.startTime
    }
  }
  recalcTask(task)
  saveTasks()
}

/**
 * 查询单个任务
 */
export async function getTask(taskId: string): Promise<ExportTaskRecord | undefined> {
  loadTasks()
  return tasks.find((t) => t.id === taskId)
}

/**
 * 查询所有任务（按创建时间倒序）
 */
export async function getTasks(): Promise<ExportTaskRecord[]> {
  loadTasks()
  return [...tasks]
}

/**
 * 清空所有任务记录
 */
export async function clearTasks(): Promise<void> {
  tasks = []
  saveTasks()
}

/**
 * 清理旧记录（保留最近 30 天，最多 200 条）
 */
export async function pruneTasks(): Promise<void> {
  loadTasks()
  const cutoff = now() - PRUNE_DAYS * 24 * 60 * 60 * 1000
  tasks = tasks
    .filter((t) => t.startTime >= cutoff)
    .slice(0, MAX_TASKS)
  saveTasks()
}

// ── 内部聚合 ──

/**
 * 根据子任务状态自动聚合父任务
 */
function recalcTask(task: ExportTaskRecord): void {
  const items = task.items
  if (items.length === 0) {
    task.status = 'pending'
    task.progress = 0
    return
  }

  const allDone = items.every((i) => i.status === 'done')
  const anyFailed = items.some((i) => i.status === 'failed')
  const allCanceled = items.every((i) => i.status === 'canceled')
  const anyActive = items.some((i) => i.status === 'queued' || i.status === 'exporting')

  if (allDone) task.status = 'completed'
  else if (anyFailed) task.status = 'failed'
  else if (allCanceled) task.status = 'canceled'
  else if (anyActive) task.status = 'exporting'
  else task.status = 'pending'

  const averageProgress = items.reduce((sum, i) => sum + i.progress, 0) / items.length
  task.progress = allDone ? 100 : Math.floor(averageProgress)

  const endTimes = items
    .filter((i) => i.endTime != null)
    .map((i) => i.endTime!)
  if (endTimes.length > 0) {
    task.endTime = Math.max(...endTimes)
    task.duration = task.endTime - task.startTime
  } else {
    task.endTime = null
    task.duration = null
  }
}

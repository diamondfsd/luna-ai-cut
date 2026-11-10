/**
 * exportTaskService.ts — 导出任务记录服务
 *
 * 职责：
 * - 任务 CRUD（创建/追加/更新/查询/取消）
 * - JSON 文件持久化（基础目录/cache/export-tasks.json）
 * - 父任务自动聚合（recalcTask）
 *
 * ExportItemInput 只需 { id, sourcePath, outputPath }，
 * fileName/kind/destinationPath 由 service 自动推断。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { currentBaseDir } from '../storage/settingsService'
import type { ExportTaskRecord, ExportTaskItem, ExportItemUpdate, ExportItemInput } from '../../src/shared/types/export'
import type { ExportTaskPayload } from '../../src/shared/types/exportTaskPayload'

// ── 常量 ──

const FILE_NAME = 'export-tasks.json'
const PAYLOAD_DIRECTORY = 'export-task-payloads'
const MAX_TASKS = 200
const PRUNE_DAYS = 30
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv'])

// ── 内存状态 ──

let tasks: ExportTaskRecord[] = []
let loaded = false

// ── 文件路径 ──

function filePath(): string {
  const dir = join(currentBaseDir(), 'cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, FILE_NAME)
}

function payloadDirectory(): string {
  const dir = join(currentBaseDir(), 'cache', PAYLOAD_DIRECTORY)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function payloadPath(taskId: string): string {
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(payloadDirectory(), `${safeId}.json`)
}

function writePayload(taskId: string, payload: ExportTaskPayload): void {
  const path = payloadPath(taskId)
  const temporaryPath = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(payload), 'utf-8')
  renameSync(temporaryPath, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isExportTaskPayload(value: unknown): value is ExportTaskPayload {
  if (!isRecord(value) || value.version !== 1 || typeof value.exportDir !== 'string' || typeof value.taskName !== 'string' || !Array.isArray(value.entries)) {
    return false
  }
  if (value.kind === 'local-media') {
    return typeof value.appleLivePhoto === 'boolean'
      && (value.exportConfig === null || isRecord(value.exportConfig))
      && value.entries.every((entry) => isRecord(entry)
        && typeof entry.id === 'string'
        && typeof entry.sourcePath === 'string'
        && typeof entry.outputPath === 'string'
        && (entry.kind === 'image' || entry.kind === 'video'))
  }
  if (value.kind === 'workspace') {
    return typeof value.stamp === 'number'
      && isRecord(value.config)
      && (value.adjustableVideoId === null || typeof value.adjustableVideoId === 'string')
      && value.entries.every((entry) => isRecord(entry)
        && typeof entry.id === 'string'
        && typeof entry.outputPath === 'string'
        && isRecord(entry.plan)
        && typeof entry.plan.sourcePath === 'string'
        && Array.isArray(entry.plan.layers))
  }
  return false
}

function payloadMatchesTask(payload: ExportTaskPayload, task: ExportTaskRecord): boolean {
  const payloadIds = new Set(payload.entries.map((entry) => entry.id))
  return payloadIds.size === task.items.length && task.items.every((item) => payloadIds.has(item.id))
}

function readPayload(taskId: string): ExportTaskPayload | undefined {
  const path = payloadPath(taskId)
  if (!existsSync(path)) return undefined
  try {
    const payload: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isExportTaskPayload(payload)) return undefined
    return payload
  } catch {
    return undefined
  }
}

function removePayload(taskId: string): void {
  const path = payloadPath(taskId)
  if (existsSync(path)) unlinkSync(path)
}

function removePayloadsExcept(retainedIds: Set<string>): void {
  const dir = payloadDirectory()
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.tmp')) {
      unlinkSync(join(dir, file))
      continue
    }
    if (!file.endsWith('.json')) continue
    const id = file.slice(0, -5)
    if (!retainedIds.has(id)) unlinkSync(join(dir, file))
  }
}

// ── 持久化 ──

/** 从 JSON 文件加载到内存 */
export function loadTasks(): void {
  if (loaded) return
  const path = filePath()
  const temporaryPath = `${path}.tmp`
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  if (!existsSync(path)) {
    tasks = []
    removePayloadsExcept(new Set())
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
  let migrated = false
  for (const task of tasks) {
    const previousStatus = task.status
    const previousResumable = task.resumable
    const previousTotalCount = task.totalCount
    task.items ??= []
    task.totalCount = task.items.length
    const payload = readPayload(task.id)
    task.resumable = Boolean(payload && payloadMatchesTask(payload, task))
    let itemMigrated = false
    for (const item of task.items) {
      if (item.status !== 'queued' && item.status !== 'exporting') continue
      item.status = 'interrupted'
      item.progress = 0
      item.endTime = null
      item.duration = null
      item.error = undefined
      itemMigrated = true
    }
    recalcTask(task)
    if (task.status === 'completed' && task.resumable) {
      removePayload(task.id)
      task.resumable = false
    }
    if (itemMigrated || previousStatus !== task.status || previousResumable !== task.resumable || previousTotalCount !== task.totalCount) {
      migrated = true
    }
  }
  removePayloadsExcept(new Set(tasks.filter((task) => task.resumable).map((task) => task.id.replace(/[^a-zA-Z0-9_-]/g, '_'))))
  if (migrated) saveTasks()
  loaded = true
}

/** 内存状态写回 JSON 文件 */
function saveTasks(): void {
  const path = filePath()
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, JSON.stringify({ version: 2, tasks }, null, 2), 'utf-8')
  renameSync(temporaryPath, path)
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
  return status === 'interrupted' || status === 'done' || status === 'failed' || status === 'canceled'
}

function inputToItem(input: ExportItemInput): ExportTaskItem {
  return {
    id: input.id,
    fileName: basename(input.outputPath),
    label: input.label,
    openTarget: input.openTarget,
    previewable: input.previewable,
    kind: inferKind(input.outputPath),
    destinationPath: input.outputPath,
    sourcePath: input.sourcePath,
    status: 'queued' as const,
    progress: 0,
    startTime: 0, // 由 updateItem 在首次 exporting 时设置为真实开始时间
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
  payload?: ExportTaskPayload,
): Promise<ExportTaskRecord> {
  loadTasks()
  const id = taskId ?? generateId()
  if (payload) writePayload(id, payload)
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
    items: (items ?? []).map((item) => inputToItem(item)),
    resumable: Boolean(payload),
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
  for (const item of items) {
    task.items.push(inputToItem(item))
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

  if (isTerminalStatus(item.status) && data.status !== undefined && data.status !== item.status) {
    return
  }

  if (data.status !== undefined) item.status = data.status
  if (data.progress !== undefined) item.progress = data.progress
  if (data.error !== undefined) item.error = data.error
  if (data.destinationPath !== undefined) item.destinationPath = data.destinationPath
  if (data.label !== undefined) item.label = data.label

  // 状态变更时更新时间
  if (data.status === 'exporting' && item.startTime === 0) {
    item.startTime = now()
  }
  if (data.status === 'done' || data.status === 'failed' || data.status === 'canceled') {
    item.endTime = now()
    item.duration = item.endTime! - item.startTime
  }

  recalcTask(task)
  const completed = task.status === 'completed'
  if (completed) task.resumable = false
  saveTasks()
  if (completed) removePayload(task.id)
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
  if (task.status === 'canceled') {
    removePayload(task.id)
    task.resumable = false
  }
  saveTasks()
}

/**
 * 查询单个任务
 */
export async function getTask(taskId: string): Promise<ExportTaskRecord | undefined> {
  loadTasks()
  return tasks.find((t) => t.id === taskId)
}

/** 原子地领取恢复任务，避免双击造成重复导出。失败/中断项重新排队，已完成项保持不变。 */
export async function beginResumeTask(taskId: string): Promise<{ task: ExportTaskRecord; payload: ExportTaskPayload } | undefined> {
  loadTasks()
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task || task.status === 'exporting' || task.status === 'completed') return undefined
  const payload = readPayload(taskId)
  if (!payload) {
    task.resumable = false
    removePayload(taskId)
    saveTasks()
    return undefined
  }
  if (!payloadMatchesTask(payload, task)) {
    task.resumable = false
    removePayload(taskId)
    saveTasks()
    return undefined
  }
  const retryableItems = task.items.filter((item) => (
    item.status === 'queued' || item.status === 'interrupted' || item.status === 'failed'
  ))
  if (retryableItems.length === 0) return undefined

  task.resumable = true
  task.status = 'exporting'
  task.endTime = null
  task.duration = null
  for (const item of retryableItems) {
    item.status = 'queued'
    item.progress = 0
    item.startTime = 0
    item.endTime = null
    item.duration = null
    item.error = undefined
  }
  recalcTask(task)
  saveTasks()
  return { task, payload }
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
  removePayloadsExcept(new Set())
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
  removePayloadsExcept(new Set(tasks.filter((task) => task.resumable).map((task) => task.id.replace(/[^a-zA-Z0-9_-]/g, '_'))))
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
  const anyCanceled = items.some((i) => i.status === 'canceled')
  const anyActive = items.some((i) => i.status === 'queued' || i.status === 'exporting')
  const anyInterrupted = items.some((i) => i.status === 'interrupted')

  if (allDone) task.status = 'completed'
  else if (anyActive) task.status = 'exporting'
  else if (anyInterrupted) task.status = 'interrupted'
  else if (anyFailed) task.status = 'failed'
  else if (anyCanceled) task.status = 'canceled'
  else task.status = 'pending'

  const averageProgress = items.reduce((sum, i) => sum + i.progress, 0) / items.length
  task.progress = allDone ? 100 : Math.floor(averageProgress)

  // 用子项真实开始时间（排除未开始的 queued 项）
  const startTimes = items
    .filter((i) => i.startTime > 0)
    .map((i) => i.startTime)
  const endTimes = items
    .filter((i) => i.endTime != null)
    .map((i) => i.endTime!)
  if (startTimes.length > 0) {
    task.startTime = Math.min(...startTimes)
  }
  if (task.status === 'exporting' || task.status === 'interrupted') {
    task.endTime = null
    task.duration = null
  } else if (endTimes.length > 0) {
    task.endTime = Math.max(...endTimes)
    task.duration = task.endTime - task.startTime
  } else {
    task.endTime = null
    task.duration = null
  }
}

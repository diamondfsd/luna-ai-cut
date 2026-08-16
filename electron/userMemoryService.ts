import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const USER_MEMORY_VERSION = 1 as const
export const USER_MEMORY_MAX_ENTRIES = 500
export const USER_MEMORY_MAX_QUERY_LENGTH = 200
export const USER_MEMORY_MAX_TEXT_LENGTH = 2_000

export type UserMemoryScope = 'global' | 'video-type'

export interface UserMemoryEntry {
  id: string
  scope: UserMemoryScope
  videoType?: string
  topic: string
  preference: string
  evidence?: string
  createdAt: number
  updatedAt: number
}

interface UserMemoryDocument {
  version: typeof USER_MEMORY_VERSION
  entries: UserMemoryEntry[]
}

export interface UserMemorySearchArgs {
  query?: string
  scope?: UserMemoryScope
  videoType?: string
  limit?: number
}

export interface UserMemoryUpdateArgs {
  memoryId?: string
  scope: UserMemoryScope
  videoType?: string
  topic: string
  preference: string
  evidence?: string
}

export interface UserMemoryReadArgs {
  memoryIds?: string[]
  scope?: UserMemoryScope
  videoType?: string
  limit?: number
}

export interface UserMemoryRemoveArgs {
  memoryIds: string[]
}

export interface UserMemoryToolResult {
  ok: boolean
  message: string
  data?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, field: string, maxLength = USER_MEMORY_MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本。`)
  const result = value.trim()
  if (!result) throw new Error(`${field} 不能为空。`)
  if (result.length > maxLength) throw new Error(`${field} 太长了，请缩短后再保存。`)
  return result
}

function optionalText(value: unknown, field: string, maxLength = USER_MEMORY_MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined) return undefined
  return text(value, field, maxLength)
}

function scopeOf(value: unknown): UserMemoryScope {
  if (value === 'global' || value === 'video-type') return value
  throw new Error('记忆范围必须是 global 或 video-type。')
}

function validateEntry(value: unknown): UserMemoryEntry | null {
  if (!isRecord(value)) return null
  const videoType = typeof value.videoType === 'string' ? value.videoType : undefined
  if (typeof value.id !== 'string' || !value.id ||
      (value.scope !== 'global' && value.scope !== 'video-type') ||
      typeof value.topic !== 'string' || !value.topic ||
      typeof value.preference !== 'string' || !value.preference ||
      typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) ||
      typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) {
    return null
  }
  if (value.id.length > 200 || value.topic.length > USER_MEMORY_MAX_TEXT_LENGTH ||
      value.preference.length > USER_MEMORY_MAX_TEXT_LENGTH ||
      (value.scope === 'video-type' && (videoType === undefined || !videoType || videoType.length > 200)) ||
      (typeof value.evidence === 'string' && value.evidence.length > 1_000)) return null
  if (value.videoType !== undefined && videoType === undefined) return null
  if (value.scope === 'global' && videoType !== undefined) return null
  if (value.evidence !== undefined && (typeof value.evidence !== 'string' || !value.evidence)) return null
  return {
    id: value.id,
    scope: value.scope,
    ...(videoType !== undefined ? { videoType } : {}),
    topic: value.topic,
    preference: value.preference,
    ...(value.evidence !== undefined ? { evidence: value.evidence } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function emptyDocument(): UserMemoryDocument {
  return { version: USER_MEMORY_VERSION, entries: [] }
}

function parseDocument(value: unknown): UserMemoryDocument {
  if (!isRecord(value) || value.version !== USER_MEMORY_VERSION || !Array.isArray(value.entries)) {
    throw new Error('用户偏好数据格式无法读取。')
  }
  const entries = value.entries.map(validateEntry)
  if (entries.some((entry) => entry === null)) throw new Error('用户偏好数据格式无法读取。')
  if (entries.length > USER_MEMORY_MAX_ENTRIES) throw new Error('用户偏好数量超出限制。')
  return { version: USER_MEMORY_VERSION, entries: entries as UserMemoryEntry[] }
}

function matches(entry: UserMemoryEntry, args: UserMemorySearchArgs | UserMemoryReadArgs): boolean {
  if (args.scope !== undefined && entry.scope !== args.scope) return false
  if (args.videoType !== undefined && entry.videoType !== args.videoType.trim()) return false
  if ('query' in args && args.query !== undefined) {
    const query = args.query.toLocaleLowerCase()
    const haystack = [entry.topic, entry.preference, entry.evidence ?? '', entry.videoType ?? '']
      .join('\n')
      .toLocaleLowerCase()
    if (!haystack.includes(query)) return false
  }
  return true
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 50
  if (!Number.isInteger(value) || value < 1 || value > USER_MEMORY_MAX_ENTRIES) {
    throw new Error(`limit 必须是 1 到 ${USER_MEMORY_MAX_ENTRIES} 之间的整数。`)
  }
  return value
}

function boundedQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return text(value, 'query', USER_MEMORY_MAX_QUERY_LENGTH).toLocaleLowerCase()
}

function boundedMemoryIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('memoryIds 必须包含不超过 50 个有效 ID。')
  }
  return value.map((id) => id.trim())
}

function normalizeFilterArgs(value: unknown, includeQuery: boolean): UserMemorySearchArgs {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('用户偏好查询参数无效。')
  const scope = value.scope === undefined ? undefined : scopeOf(value.scope)
  const videoType = value.videoType === undefined ? undefined : text(value.videoType, 'videoType', 200)
  const query = includeQuery && value.query !== undefined
    ? text(value.query, 'query', USER_MEMORY_MAX_QUERY_LENGTH).toLocaleLowerCase()
    : undefined
  if (scope === 'global' && videoType !== undefined) throw new Error('global 查询不能提供 videoType。')
  return {
    ...(query !== undefined ? { query } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(videoType !== undefined ? { videoType } : {}),
    ...(value.limit !== undefined ? { limit: boundedLimit(value.limit as number) } : {}),
  }
}

function publicEntry(entry: UserMemoryEntry): UserMemoryEntry {
  return { ...entry }
}

export function createUserMemoryStore(rootDirectory: string) {
  const filePath = path.join(rootDirectory, 'preferences.json')
  let operationQueue = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function readDocument(): Promise<UserMemoryDocument> {
    try {
      return parseDocument(JSON.parse(await fs.readFile(filePath, 'utf8')))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return emptyDocument()
      }
      if (error instanceof SyntaxError) throw new Error('用户偏好数据格式无法读取。')
      throw error
    }
  }

  async function writeDocument(document: UserMemoryDocument): Promise<void> {
    await fs.mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await fs.rename(temporaryPath, filePath)
      await fs.chmod(filePath, 0o600).catch(() => undefined)
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  async function search(rawArgs: UserMemorySearchArgs = {}): Promise<UserMemoryToolResult> {
    const args = normalizeFilterArgs(rawArgs, true)
    const query = boundedQuery(args.query)
    return serialize(async () => {
      const document = await readDocument()
      const filtered = document.entries.filter((entry) => matches(entry, { ...args, query }))
      const limit = boundedLimit(args.limit)
      return {
        ok: true,
        message: `找到 ${Math.min(filtered.length, limit)} 条用户偏好。`,
        data: {
          entries: filtered.slice(0, limit).map(publicEntry),
          total: filtered.length,
          truncated: filtered.length > limit,
        },
      }
    })
  }

  async function read(rawArgs: UserMemoryReadArgs = {}): Promise<UserMemoryToolResult> {
    if (!isRecord(rawArgs)) throw new Error('用户偏好读取参数无效。')
    const args = normalizeFilterArgs(rawArgs, false) as UserMemoryReadArgs
    const memoryIds = boundedMemoryIds(rawArgs.memoryIds)
    return serialize(async () => {
      const document = await readDocument()
      const ids = memoryIds === undefined ? undefined : new Set(memoryIds)
      const filtered = document.entries
        .filter((entry) => ids === undefined || ids.has(entry.id))
        .filter((entry) => matches(entry, args))
      const limit = boundedLimit(args.limit)
      return {
        ok: true,
        message: `已读取 ${Math.min(filtered.length, limit)} 条用户偏好。`,
        data: {
          entries: filtered.slice(0, limit).map(publicEntry),
          total: filtered.length,
          truncated: filtered.length > limit,
        },
      }
    })
  }

  async function update(rawArgs: UserMemoryUpdateArgs): Promise<UserMemoryToolResult> {
    if (!isRecord(rawArgs)) throw new Error('用户偏好更新参数无效。')
    const args = rawArgs as UserMemoryUpdateArgs
    if (args.memoryId !== undefined) args.memoryId = text(args.memoryId, 'memoryId', 200)
    const scope = scopeOf(args.scope)
    const topic = text(args.topic, 'topic')
    const preference = text(args.preference, 'preference')
    const evidence = optionalText(args.evidence, 'evidence', 1_000)
    const videoType = args.videoType === undefined ? undefined : text(args.videoType, 'videoType', 200)
    if (scope === 'video-type' && videoType === undefined) {
      throw new Error('video-type 记忆必须提供 videoType。')
    }
    if (scope === 'global' && videoType !== undefined) {
      throw new Error('global 记忆不能提供 videoType。')
    }

    return serialize(async () => {
      const document = await readDocument()
      const now = Date.now()
      const index = args.memoryId === undefined
        ? -1
        : document.entries.findIndex((entry) => entry.id === args.memoryId)
      if (args.memoryId !== undefined && index < 0) throw new Error('没有找到要更新的用户偏好。')
      const existing = index >= 0 ? document.entries[index] : undefined
      const entry: UserMemoryEntry = {
        id: args.memoryId ?? randomUUID(),
        scope,
        ...(videoType !== undefined ? { videoType } : {}),
        topic,
        preference,
        ...((evidence ?? existing?.evidence) !== undefined ? { evidence: evidence ?? existing?.evidence } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (index >= 0) document.entries[index] = entry
      else document.entries.unshift(entry)
      if (document.entries.length > USER_MEMORY_MAX_ENTRIES) document.entries.length = USER_MEMORY_MAX_ENTRIES
      await writeDocument(document)
      return {
        ok: true,
        message: index >= 0 ? '已更新用户偏好。' : '已记录用户偏好。',
        data: { entry: publicEntry(entry) },
      }
    })
  }

  async function remove(rawArgs: UserMemoryRemoveArgs): Promise<UserMemoryToolResult> {
    if (!isRecord(rawArgs)) throw new Error('用户偏好移除参数无效。')
    const memoryIds = boundedMemoryIds(rawArgs.memoryIds)
    if (memoryIds === undefined || memoryIds.length < 1) throw new Error('memoryIds 必须包含至少 1 个有效 ID。')
    return serialize(async () => {
      const document = await readDocument()
      const ids = new Set(memoryIds)
      const removed = document.entries.filter((entry) => ids.has(entry.id)).map((entry) => entry.id)
      if (removed.length > 0) {
        document.entries = document.entries.filter((entry) => !ids.has(entry.id))
        await writeDocument(document)
      }
      return {
        ok: true,
        message: removed.length > 0 ? `已移除 ${removed.length} 条用户偏好。` : '没有找到要移除的用户偏好。',
        data: { removedIds: removed, missingIds: memoryIds.filter((id) => !removed.includes(id)) },
      }
    })
  }

  return { filePath, read, search, update, remove }
}

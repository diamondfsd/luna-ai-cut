import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoryError, type MemoryDocument } from './memoryTypes.ts'

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const version = (value: unknown): boolean => Number.isInteger(value) && Number(value) > 0
const date = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value))
function validVersion(value: unknown): boolean {
  if (!isObject(value) || !version(value.version) || !text(value.content) || !['recorded', 'candidate'].includes(String(value.status)) || !date(value.updatedAt)) return false
  const source = value.source
  return isObject(source) && text(source.id) && source.origin === 'task-request' && text(source.taskId)
    && version(source.revision) && (source.actorId === null || text(source.actorId))
    && text(source.request) && text(source.quote) && source.request.includes(source.quote) && date(source.recordedAt)
}
function validDocument(value: unknown): value is MemoryDocument {
  if (!isObject(value) || value.formatVersion !== 1 || !Array.isArray(value.records) || !Array.isArray(value.receipts)) return false
  const validRecords = value.records.every(record => isObject(record) && validVersion(record) && text(record.id)
    && ['user-context', 'preference', 'project-decision', 'analysis'].includes(String(record.kind))
    && isObject(record.scope) && (record.scope.kind === 'user' || (record.scope.kind === 'project' && text(record.scope.id)))
    && (record.kind !== 'project-decision' || record.scope.kind === 'project')
    && date(record.createdAt) && Array.isArray(record.history) && record.history.every(validVersion))
  const validReceipts = value.receipts.every(receipt => isObject(receipt) && text(receipt.key) && text(receipt.fingerprint)
    && text(receipt.memoryId) && version(receipt.version) && ['save', 'forget'].includes(String(receipt.operation)))
  return validRecords && validReceipts && new Set(value.records.map(record => record.id)).size === value.records.length
    && new Set(value.receipts.map(receipt => receipt.key)).size === value.receipts.length
}

/** Single-owner serial commits; corruption is an error, never an empty replacement database. */
export function createMemoryRepository(directory: () => Promise<string>) {
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false
  return {
    flush: () => queue,
    close: () => { closed = true; return queue },
    transact<T>(authorize: () => void, operation: (document: MemoryDocument) => { result: T; changed?: boolean }): Promise<T> {
      if (closed) return Promise.reject(new MemoryError('MEMORY_UNAVAILABLE', '应用正在退出'))
      const next = queue.then(async () => {
        const dir = await directory()
        const file = join(dir, 'memories.json')
        authorize()
        let document: MemoryDocument = { formatVersion: 1, records: [], receipts: [] }
        try {
          const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
          if (!validDocument(saved)) throw new MemoryError('MEMORY_STORAGE_INVALID', '记忆内容无效')
          document = saved
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        authorize()
        const change = operation(document)
        if (change.changed) {
          await mkdir(dir, { recursive: true, mode: 0o700 })
          const temporary = join(dir, `${randomUUID()}.tmp`)
          try {
            await writeFile(temporary, JSON.stringify(document), { mode: 0o600 })
            authorize()
            await rename(temporary, file)
          } finally { await rm(temporary, { force: true }) }
        }
        return change.result
      })
      queue = next.catch(() => undefined)
      return next
    },
  }
}
export type MemoryRepository = ReturnType<typeof createMemoryRepository>

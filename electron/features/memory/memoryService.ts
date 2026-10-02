import { createHash, randomUUID } from 'node:crypto'
import type { MemoryRepository } from './memoryRepository.ts'
import { MemoryError, type MemoryAccess, type MemoryDocument, type MemoryRecord, type MemorySaveInput } from './memoryTypes.ts'

function accessible(memory: MemoryRecord, access: MemoryAccess): boolean {
  return memory.scope.kind === 'user' || memory.scope.id === access.projectId
}
function find(document: MemoryDocument, id: string, access: MemoryAccess): MemoryRecord {
  const record = document.records.find(item => item.id === id && accessible(item, access))
  if (!record) throw new MemoryError('MEMORY_NOT_FOUND', '记忆不存在')
  return record
}
function receipt(document: MemoryDocument, access: MemoryAccess, key: string, input: unknown) {
  const receiptKey = createHash('sha256').update(JSON.stringify([access.taskId, key])).digest('hex')
  const fingerprint = createHash('sha256').update(JSON.stringify([access.revision, input])).digest('hex')
  const saved = document.receipts.find(item => item.key === receiptKey)
  if (saved && saved.fingerprint !== fingerprint) throw new MemoryError('IDEMPOTENCY_CONFLICT', '请勿复用不同操作的保存编号')
  return { receiptKey, fingerprint, saved }
}

/** Shared app memory. Session/revision enforcement belongs to the adapter's access callback. */
export function createMemoryService(repository: MemoryRepository) {
  return {
    flush: repository.flush,
    close: repository.close,
    search(access: MemoryAccess, options: { query?: string; scope?: 'user' | 'project'; kind?: MemoryRecord['kind']; limit?: number }) {
      return repository.transact(access.assertCurrent, document => {
        const query = options.query?.trim().toLocaleLowerCase() ?? ''
        const records = document.records.filter(item => accessible(item, access)
          && (!options.scope || item.scope.kind === options.scope) && (!options.kind || item.kind === options.kind)
          && (!query || `${item.content} ${item.source.quote}`.toLocaleLowerCase().includes(query)))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        return { result: { records: records.slice(0, options.limit ?? 20).map(record => ({
          id: record.id, kind: record.kind, scope: record.scope, content: record.content, status: record.status,
          version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt,
          source: { id: record.source.id, origin: record.source.origin, taskId: record.source.taskId,
            revision: record.source.revision, quote: record.source.quote, recordedAt: record.source.recordedAt },
        })), total: records.length } }
      })
    },
    get(access: MemoryAccess, memoryId: string) {
      return repository.transact(access.assertCurrent, document => ({ result: find(document, memoryId, access) }))
    },
    save(access: MemoryAccess, input: MemorySaveInput) {
      return repository.transact(access.assertCurrent, document => {
        if (!input.sourceQuote.trim() || !access.request.includes(input.sourceQuote)) throw new MemoryError('SOURCE_UNVERIFIED', '记忆来源与当前要求不符')
        if (input.scope === 'project' && !access.projectId) throw new MemoryError('MEMORY_SCOPE_REQUIRED', '请先关联项目')
        if (input.kind === 'project-decision' && input.scope !== 'project') throw new MemoryError('MEMORY_SCOPE_INVALID', '本次项目决定不能保存为全局偏好')
        const replay = receipt(document, access, input.idempotencyKey, ['save', input.kind, input.scope, input.content, input.sourceQuote, input.memoryId, input.expectedVersion])
        if (replay.saved) return { result: { memory: find(document, replay.saved.memoryId, access), replayed: true } }
        const previous = input.memoryId ? find(document, input.memoryId, access) : null
        if (previous && previous.version !== input.expectedVersion) throw new MemoryError('MEMORY_VERSION_CONFLICT', '记忆已更新，请重新读取')
        if (previous && (previous.kind !== input.kind || previous.scope.kind !== input.scope)) throw new MemoryError('MEMORY_SCOPE_INVALID', '不能更改记忆类型或范围')
        const timestamp = new Date().toISOString()
        const memory: MemoryRecord = {
          id: previous?.id ?? randomUUID(), kind: input.kind,
          scope: input.scope === 'project' ? { kind: 'project', id: access.projectId! } : { kind: 'user' },
          content: input.content, status: input.content === input.sourceQuote && input.kind !== 'analysis' ? 'recorded' : 'candidate',
          version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
          source: { id: randomUUID(), origin: 'task-request', taskId: access.taskId, revision: access.revision,
            actorId: access.actorId, request: access.request, quote: input.sourceQuote, recordedAt: timestamp },
          history: previous ? [...previous.history, { version: previous.version, content: previous.content, status: previous.status,
            source: previous.source, updatedAt: previous.updatedAt }] : [],
        }
        document.records = [...document.records.filter(item => item.id !== memory.id), memory]
        document.receipts.push({ key: replay.receiptKey, fingerprint: replay.fingerprint, memoryId: memory.id, version: memory.version, operation: 'save' })
        return { result: { memory, replayed: false }, changed: true }
      })
    },
    forget(access: MemoryAccess, input: { memoryId: string; expectedVersion: number; idempotencyKey: string }) {
      return repository.transact(access.assertCurrent, document => {
        const replay = receipt(document, access, input.idempotencyKey, ['forget', input.memoryId, input.expectedVersion])
        if (replay.saved) return { result: { memoryId: input.memoryId, forgotten: true } }
        const memory = find(document, input.memoryId, access)
        if (memory.version !== input.expectedVersion) throw new MemoryError('MEMORY_VERSION_CONFLICT', '记忆已更新，请重新读取')
        document.records = document.records.filter(item => item.id !== memory.id)
        document.receipts.push({ key: replay.receiptKey, fingerprint: replay.fingerprint, memoryId: memory.id, version: memory.version + 1, operation: 'forget' })
        return { result: { memoryId: memory.id, forgotten: true }, changed: true }
      })
    },
  }
}
export type MemoryService = ReturnType<typeof createMemoryService>

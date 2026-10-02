/** Application memory contracts have no editor, renderer or Agent platform dependency. */
export type MemoryKind = 'user-context' | 'preference' | 'project-decision' | 'analysis'
export type MemoryScope = { kind: 'user' } | { kind: 'project'; id: string }
export interface MemorySource {
  id: string
  origin: 'task-request'
  taskId: string
  revision: number
  actorId: string | null
  request: string
  quote: string
  recordedAt: string
}
export interface MemoryVersion {
  version: number
  content: string
  status: 'recorded' | 'candidate'
  source: MemorySource
  updatedAt: string
}
export interface MemoryRecord extends MemoryVersion {
  id: string
  kind: MemoryKind
  scope: MemoryScope
  createdAt: string
  history: MemoryVersion[]
}
export interface MemoryReceipt {
  key: string
  fingerprint: string
  memoryId: string
  version: number
  operation: 'save' | 'forget'
}
export interface MemoryDocument {
  formatVersion: 1
  records: MemoryRecord[]
  receipts: MemoryReceipt[]
}
/** The tool adapter supplies this trusted context; callers cannot declare their own source actor. */
export interface MemoryAccess {
  taskId: string
  revision: number
  projectId: string | null
  actorId: string | null
  request: string
  assertCurrent(): void
}
export interface MemorySaveInput {
  kind: MemoryKind
  scope: 'user' | 'project'
  content: string
  sourceQuote: string
  idempotencyKey: string
  memoryId?: string
  expectedVersion?: number
}
export class MemoryError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

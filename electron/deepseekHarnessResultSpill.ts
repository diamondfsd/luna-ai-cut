import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'

/** Keep capability responses small enough that the next model turn remains usable. */
export const MAX_INLINE_RESULT_BYTES = 128 * 1024

export interface ExternalFileReference {
  path: string
  format: 'json'
  encoding: 'utf-8'
  bytes: number
  lines: number
  sha256: string
  description: string
}

export interface LargeResultSummary {
  valueType: 'array' | 'object' | 'scalar'
  objectKeys?: string[]
  collectionCounts?: Record<string, number>
  scalarFields?: Record<string, boolean | number | string | null>
}

export interface ExternalizedResult {
  externalFile: ExternalFileReference
  summary: LargeResultSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value: unknown): value is boolean | number | string | null {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
}

function collectArrayCounts(record: Record<string, unknown>, counts: Record<string, number>): void {
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) counts[key] = value.length
  }
}

export function summarizeLargeResult(value: unknown): LargeResultSummary {
  if (Array.isArray(value)) {
    return { valueType: 'array', collectionCounts: { items: value.length } }
  }
  if (!isRecord(value)) return { valueType: 'scalar' }

  const collectionCounts: Record<string, number> = {}
  collectArrayCounts(value, collectionCounts)
  if (isRecord(value.timeline)) collectArrayCounts(value.timeline, collectionCounts)

  const scalarFields: Record<string, boolean | number | string | null> = {}
  for (const key of [
    'projectId', 'fps', 'currentFrame', 'inPoint', 'outPoint', 'durationSeconds', 'total',
  ]) {
    const candidate = value[key]
    if (isScalar(candidate)) scalarFields[key] = candidate
  }
  if (isRecord(value.project) && isScalar(value.project.id)) scalarFields.projectId ??= value.project.id

  return {
    valueType: 'object',
    objectKeys: Object.keys(value),
    ...(Object.keys(collectionCounts).length > 0 ? { collectionCounts } : {}),
    ...(Object.keys(scalarFields).length > 0 ? { scalarFields } : {}),
  }
}

function safeCapabilityName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return safe || 'capability-result'
}

function relativeSessionPath(sessionRoot: string, filePath: string): string {
  return path.relative(sessionRoot, filePath).split(path.sep).join('/')
}

async function writePrivateFileAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporaryPath, filePath)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function externalizeLargeResult(
  capabilityName: string,
  value: unknown,
  sessionRoot: string,
): Promise<unknown> {
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) return value
  const content = `${serialized}\n`
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes <= MAX_INLINE_RESULT_BYTES) return value

  const fileName = `${safeCapabilityName(capabilityName)}-${randomUUID()}.json`
  const filePath = path.join(sessionRoot, 'luna-results', fileName)
  await writePrivateFileAtomically(filePath, content)
  const externalFile: ExternalFileReference = {
    path: relativeSessionPath(sessionRoot, filePath),
    format: 'json',
    encoding: 'utf-8',
    bytes,
    lines: content.split('\n').length,
    sha256: createHash('sha256').update(content).digest('hex'),
    description: '完整结果已保存到当前会话工作区。请使用 Harness 的 read 工具按 offset 和 limit 分段读取。',
  }
  return {
    externalFile,
    summary: summarizeLargeResult(value),
  } satisfies ExternalizedResult
}

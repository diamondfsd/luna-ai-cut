import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'

export type AiEditorCatalogMediaKind = 'image' | 'video' | 'audio'

interface CatalogEntry {
  filePath: string
  kind: AiEditorCatalogMediaKind
}

interface CatalogFile {
  version: 1
  nextId: number
  entries: Record<string, CatalogEntry>
}

const catalogDirName = 'ai-editor'
const catalogFileName = 'media-index.json'
const catalogCache = new Map<string, CatalogFile>()
const catalogLocks = new Map<string, Promise<unknown>>()

function catalogPathFor(baseDir: string): string {
  return path.join(baseDir, catalogDirName, catalogFileName)
}

function normalizedPath(filePath: string): string {
  return path.resolve(filePath)
}

function emptyCatalog(): CatalogFile {
  return { version: 1, nextId: 1, entries: {} }
}

function normalizeCatalog(value: unknown): CatalogFile {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const entriesRecord = record?.entries && typeof record.entries === 'object'
    ? record.entries as Record<string, unknown>
    : {}
  const entries: Record<string, CatalogEntry> = {}
  let highestId = 0

  for (const [mediaId, entry] of Object.entries(entriesRecord)) {
    if (!/^m\d+$/.test(mediaId)) continue
    const entryRecord = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
    const filePath = typeof entryRecord?.filePath === 'string' ? entryRecord.filePath.trim() : ''
    const kind = entryRecord?.kind
    if (!filePath || (kind !== 'image' && kind !== 'video' && kind !== 'audio')) continue
    entries[mediaId] = { filePath: normalizedPath(filePath), kind }
    highestId = Math.max(highestId, Number(mediaId.slice(1)))
  }

  const requestedNextId = typeof record?.nextId === 'number' && Number.isInteger(record.nextId)
    ? record.nextId
    : 1
  return {
    version: 1,
    nextId: Math.max(requestedNextId, highestId + 1, 1),
    entries,
  }
}

async function readCatalog(baseDir: string): Promise<CatalogFile> {
  const cacheKey = path.resolve(baseDir)
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached

  let catalog = emptyCatalog()
  try {
    const raw = await fs.readFile(catalogPathFor(baseDir), 'utf8')
    catalog = normalizeCatalog(JSON.parse(raw))
  } catch {
    catalog = emptyCatalog()
  }
  catalogCache.set(cacheKey, catalog)
  return catalog
}

async function writeCatalog(baseDir: string, catalog: CatalogFile): Promise<void> {
  const catalogPath = catalogPathFor(baseDir)
  await fs.mkdir(path.dirname(catalogPath), { recursive: true })
  const temporaryPath = `${catalogPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temporaryPath, catalogPath)
  catalogCache.set(path.resolve(baseDir), catalog)
}

function withCatalogLock<T>(baseDir: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(baseDir)
  const previous = catalogLocks.get(key) ?? Promise.resolve()
  const run = previous.then(operation, operation)
  catalogLocks.set(key, run.catch(() => undefined))
  return run
}

export async function assignAiEditorMediaIds(
  baseDir: string,
  files: readonly { filePath: string; kind: AiEditorCatalogMediaKind }[],
): Promise<Map<string, string>> {
  return withCatalogLock(baseDir, async () => {
    const catalog = await readCatalog(baseDir)
    const idByPath = new Map<string, string>()
    for (const [mediaId, entry] of Object.entries(catalog.entries)) {
      idByPath.set(entry.filePath, mediaId)
    }

    let changed = false
    const result = new Map<string, string>()
    for (const file of files) {
      const filePath = normalizedPath(file.filePath)
      let mediaId = idByPath.get(filePath)
      if (!mediaId) {
        mediaId = `m${catalog.nextId++}`
        catalog.entries[mediaId] = { filePath, kind: file.kind }
        idByPath.set(filePath, mediaId)
        changed = true
      } else if (catalog.entries[mediaId]?.kind !== file.kind) {
        catalog.entries[mediaId] = { ...catalog.entries[mediaId], kind: file.kind }
        changed = true
      }
      result.set(filePath, mediaId)
    }

    if (changed) await writeCatalog(baseDir, catalog)
    return result
  })
}

export async function assignAiEditorMediaId(
  baseDir: string,
  filePath: string,
  kind: AiEditorCatalogMediaKind,
): Promise<string> {
  const ids = await assignAiEditorMediaIds(baseDir, [{ filePath, kind }])
  const mediaId = ids.get(normalizedPath(filePath))
  if (!mediaId) throw new Error('无法分配素材编号')
  return mediaId
}

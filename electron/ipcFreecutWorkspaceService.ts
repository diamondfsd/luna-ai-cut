import { ipcMain } from 'electron'
import { mkdir, readFile, readdir, lstat, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FreecutWorkspaceEntry } from '../src/shared/types'
import { currentBaseDir } from './settingsService'

const WORKSPACE_DIRECTORY = 'freecut-workspace'
const NON_SOURCE_MEDIA_FILES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
])
const writers = new Map<string, { targetPath: string; temporaryPath: string; rootPath: string; tail: Promise<void> }>()

function workspaceRoot(): string {
  return path.join(currentBaseDir(), WORKSPACE_DIRECTORY)
}

function validateSegments(segments: string[]): void {
  if (!Array.isArray(segments) || segments.some((segment) => (
    typeof segment !== 'string'
    || segment.length === 0
    || segment === '.'
    || segment === '..'
    || segment.includes('/')
    || segment.includes('\\')
  ))) {
    throw new Error('工作区路径无效')
  }
}

function resolveWorkspacePath(segments: string[], root = workspaceRoot()): string {
  validateSegments(segments)
  return path.join(root, ...segments)
}

async function findMediaSourcePath(mediaId: string): Promise<string | null> {
  validateSegments([mediaId])
  const mediaPath = resolveWorkspacePath(['media', mediaId])
  let entries
  try {
    entries = await readdir(mediaPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const source = entries.find((entry) => entry.isFile() && !NON_SOURCE_MEDIA_FILES.has(entry.name))
  return source ? path.join(mediaPath, source.name) : null
}

function ensureContained(candidate: string, rootPath = workspaceRoot()): void {
  const root = path.resolve(rootPath)
  const relative = path.relative(root, path.resolve(candidate))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('工作区路径无效')
  }
}

async function ensureParent(filePath: string, rootPath = workspaceRoot()): Promise<void> {
  ensureContained(filePath, rootPath)
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function statKind(targetPath: string): Promise<'file' | 'directory' | null> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) throw new Error('工作区不支持符号链接')
    return stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function enqueueWriter<T>(writerId: string, operation: () => Promise<T>): Promise<T> {
  const writer = writers.get(writerId)
  if (!writer) throw new Error('工作区写入任务不存在')
  const result = writer.tail.then(operation)
  writer.tail = result.then(() => undefined, () => undefined)
  return result
}

function toBuffer(data: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(data))
}

export function register(): void {
  ipcMain.handle('freecut-workspace:ensure-root', async () => {
    const root = workspaceRoot()
    await mkdir(root, { recursive: true })
    return { name: path.basename(root), path: root }
  })

  ipcMain.handle('freecut-workspace:get-media-source-path', (_event, mediaId: string) =>
    typeof mediaId === 'string' ? findMediaSourcePath(mediaId) : null,
  )

  ipcMain.handle(
    'freecut-workspace:get-entry',
    async (_event, segments: string[], expectedKind: 'file' | 'directory', create: boolean) => {
      const targetPath = resolveWorkspacePath(segments)
      let kind = await statKind(targetPath)
      if (!kind && create) {
        if (expectedKind === 'directory') {
          await mkdir(targetPath, { recursive: true })
        } else {
          await ensureParent(targetPath)
          await writeFile(targetPath, Buffer.alloc(0), { flag: 'a' })
        }
        kind = expectedKind
      }
      if (kind && kind !== expectedKind) throw new Error('工作区项目类型不匹配')
      return kind === expectedKind
    },
  )

  ipcMain.handle('freecut-workspace:list', async (_event, segments: string[]) => {
    const directoryPath = resolveWorkspacePath(segments)
    if (await statKind(directoryPath) !== 'directory') return null
    const entries = await readdir(directoryPath, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .map<FreecutWorkspaceEntry>((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }))
  })

  ipcMain.handle('freecut-workspace:read-file', async (_event, segments: string[]) => {
    const filePath = resolveWorkspacePath(segments)
    if (await statKind(filePath) !== 'file') return null
    const data = await readFile(filePath)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  })

  ipcMain.handle('freecut-workspace:open-writer', async (_event, segments: string[]) => {
    const rootPath = workspaceRoot()
    const targetPath = resolveWorkspacePath(segments, rootPath)
    await ensureParent(targetPath, rootPath)
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    const writerId = randomUUID()
    writers.set(writerId, { targetPath, temporaryPath, rootPath, tail: Promise.resolve() })
    return writerId
  })

  ipcMain.handle('freecut-workspace:write-writer', (_event, writerId: string, data: ArrayBuffer) =>
    enqueueWriter(writerId, () => writeFile(writers.get(writerId)!.temporaryPath, toBuffer(data), { flag: 'a' })),
  )

  ipcMain.handle('freecut-workspace:close-writer', async (_event, writerId: string) => {
    const writer = writers.get(writerId)
    if (!writer) throw new Error('工作区写入任务不存在')
    try {
      await enqueueWriter(writerId, async () => {
        await ensureParent(writer.targetPath, writer.rootPath)
        await rename(writer.temporaryPath, writer.targetPath)
      })
    } finally {
      writers.delete(writerId)
      await rm(writer.temporaryPath, { force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle('freecut-workspace:abort-writer', async (_event, writerId: string) => {
    const writer = writers.get(writerId)
    if (!writer) return
    writers.delete(writerId)
    await writer.tail
    await rm(writer.temporaryPath, { force: true })
  })

  ipcMain.handle('freecut-workspace:remove-entry', async (_event, segments: string[], recursive: boolean) => {
    const rootPath = workspaceRoot()
    const targetPath = resolveWorkspacePath(segments, rootPath)
    ensureContained(targetPath, rootPath)
    await rm(targetPath, { recursive, force: true })
  })

  ipcMain.handle('freecut-workspace:move-file', async (_event, source: string[], destination: string[]) => {
    const rootPath = workspaceRoot()
    const sourcePath = resolveWorkspacePath(source, rootPath)
    const destinationPath = resolveWorkspacePath(destination, rootPath)
    await ensureParent(destinationPath, rootPath)
    await rename(sourcePath, destinationPath)
  })
}

import { createHash } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface LocalMediaShareFileRoot {
  id: string
  name: string
  directoryPath?: string
  filePaths?: string[]
}

export interface SharedFileRecord {
  id: string
  absolutePath: string
  name: string
  mimeType: string
  size: number
  modifiedAt: number
}

export interface SharedFileItem {
  kind: 'directory' | 'file'
  id: string
  name: string
  path: string
  size?: number
  mimeType?: string
  modifiedAt?: number
}

function sharedFileId(rootId: string, filePath: string): string {
  return createHash('sha256').update(`${rootId}\0${filePath}`).digest('base64url').slice(0, 24)
}

function sharedDirectoryId(rootId: string, directoryPath: string): string {
  return `directory-${sharedFileId(rootId, directoryPath)}`
}

function mimeTypeForPath(filePath: string): string {
  const extension = filePath.toLowerCase().match(/\.[^./\\]+$/)?.[0]
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.txt': 'text/plain',
  }
  return extension ? types[extension] ?? 'application/octet-stream' : 'application/octet-stream'
}

export function safeRelativePath(value: string | null): string | null {
  if (!value) return ''
  if (value.includes('\\') || value.startsWith('/') || value.includes('\0')) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  const remainder = relative(root, candidate)
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder))
}

export async function listSharedFileItems(
  root: LocalMediaShareFileRoot,
  requestedPath: string,
  fileMap: Map<string, SharedFileRecord>,
): Promise<{ items: SharedFileItem[]; path: string }> {
  if (root.filePaths) {
    const items: SharedFileItem[] = []
    for (const filePath of root.filePaths) {
      try {
        const resolvedPath = await realpath(filePath)
        const fileStat = await stat(resolvedPath)
        if (!fileStat.isFile()) continue
        const id = sharedFileId(root.id, resolvedPath)
        const record: SharedFileRecord = {
          id,
          absolutePath: resolvedPath,
          name: basename(resolvedPath),
          mimeType: mimeTypeForPath(resolvedPath),
          size: fileStat.size,
          modifiedAt: fileStat.mtimeMs,
        }
        fileMap.set(id, record)
        items.push({ kind: 'file', id, name: record.name, path: '', size: record.size, mimeType: record.mimeType, modifiedAt: record.modifiedAt })
      } catch {
        // Files may disappear after the share starts.
      }
    }
    return { items: items.sort((left, right) => left.name.localeCompare(right.name)), path: '' }
  }

  if (!root.directoryPath) return { items: [], path: requestedPath }
  let directoryPath: string
  try {
    const rootPath = await realpath(root.directoryPath)
    directoryPath = resolve(rootPath, requestedPath)
    if (!isPathInside(rootPath, directoryPath)) return { items: [], path: requestedPath }
    const resolvedDirectory = await realpath(directoryPath)
    if (!isPathInside(rootPath, resolvedDirectory)) return { items: [], path: requestedPath }
    const directoryStat = await stat(resolvedDirectory)
    if (!directoryStat.isDirectory()) return { items: [], path: requestedPath }
    directoryPath = resolvedDirectory
  } catch {
    return { items: [], path: requestedPath }
  }

  const rootPath = await realpath(root.directoryPath).catch(() => '')
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const items: SharedFileItem[] = []
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name)
    try {
      const resolvedEntry = await realpath(entryPath)
      if (!isPathInside(rootPath, resolvedEntry)) continue
      const entryStat = await stat(resolvedEntry)
      const entryRelativePath = relative(rootPath, resolvedEntry).split(sep).join('/')
      if (entryStat.isDirectory()) {
        items.push({ kind: 'directory', id: sharedDirectoryId(root.id, resolvedEntry), name: entry.name, path: entryRelativePath })
      } else if (entryStat.isFile()) {
        const id = sharedFileId(root.id, resolvedEntry)
        const record: SharedFileRecord = {
          id,
          absolutePath: resolvedEntry,
          name: entry.name,
          mimeType: mimeTypeForPath(resolvedEntry),
          size: entryStat.size,
          modifiedAt: entryStat.mtimeMs,
        }
        fileMap.set(id, record)
        items.push({ kind: 'file', id, name: entry.name, path: entryRelativePath, size: record.size, mimeType: record.mimeType, modifiedAt: record.modifiedAt })
      }
    } catch {
      // An entry can disappear while this level is being read.
    }
  }
  return {
    items: items.sort((left, right) => Number(left.kind === 'file') - Number(right.kind === 'file') || left.name.localeCompare(right.name)),
    path: rootPath ? relative(rootPath, directoryPath).split(sep).join('/') : requestedPath,
  }
}

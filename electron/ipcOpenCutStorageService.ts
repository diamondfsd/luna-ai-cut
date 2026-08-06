import { app, ipcMain } from 'electron'
import { mkdir, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

function storageRoot(): string {
  return join(app.getPath('userData'), 'opencut-editor')
}

function safePart(value: string, label: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid OpenCut ${label}`)
  }
  return value
}

function namespaceDir(namespace: string): string {
  const parts = namespace.split('/').map((part) => safePart(part, 'namespace'))
  return join(storageRoot(), ...parts)
}

function entryPath(namespace: string, key: string, extension: 'json' | 'bin'): string {
  return join(namespaceDir(namespace), `${safePart(key, 'storage key')}.${extension}`)
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function listKeys(namespace: string, extension: 'json' | 'bin'): Promise<string[]> {
  try {
    const suffix = `.${extension}`
    return (await readdir(namespaceDir(namespace), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name.slice(0, -suffix.length))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function register(): void {
  ipcMain.handle('opencut-storage:get-json', async (_event, namespace: string, key: string) => {
    const data = await readOptional(entryPath(namespace, key, 'json'))
    return data ? JSON.parse(data.toString('utf8')) : null
  })
  ipcMain.handle('opencut-storage:set-json', async (_event, namespace: string, key: string, value: unknown) => {
    await atomicWrite(entryPath(namespace, key, 'json'), `${JSON.stringify(value)}\n`)
  })
  ipcMain.handle('opencut-storage:get-binary', async (_event, namespace: string, key: string) => {
    return await readOptional(entryPath(namespace, key, 'bin'))
  })
  ipcMain.handle('opencut-storage:set-binary', async (_event, namespace: string, key: string, value: Uint8Array) => {
    await atomicWrite(entryPath(namespace, key, 'bin'), value)
  })
  ipcMain.handle('opencut-storage:remove', async (_event, namespace: string, key: string) => {
    await Promise.all([
      rm(entryPath(namespace, key, 'json'), { force: true }),
      rm(entryPath(namespace, key, 'bin'), { force: true }),
    ])
  })
  ipcMain.handle('opencut-storage:list', async (_event, namespace: string, extension: 'json' | 'bin') => {
    if (extension !== 'json' && extension !== 'bin') throw new Error('Invalid OpenCut storage type')
    return await listKeys(namespace, extension)
  })
  ipcMain.handle('opencut-storage:clear', async (_event, namespace: string) => {
    await rm(namespaceDir(namespace), { recursive: true, force: true })
  })
  ipcMain.handle('opencut-storage:capacity', async () => {
    const root = storageRoot()
    await mkdir(root, { recursive: true })
    const info = await statfs(root)
    return { availableBytes: Number(info.bavail) * Number(info.bsize) }
  })
}

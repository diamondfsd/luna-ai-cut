import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BACKGROUND_MIGRATION_WINDOW_TITLE } from './startupWindowService'

const MIGRATION_STATE_FILE = '.freecut-origin-migration.json'
const WORKSPACE_DIRECTORY = 'luna-freecut'
const CHUNK_SIZE = 512 * 1024

type MigrationStatus = 'copying' | 'complete' | 'no-legacy-workspace' | 'target-already-initialized'

interface MigrationState {
  status: MigrationStatus
  completedAt?: string
}

interface WorkspaceFile {
  path: string[]
  size: number
}

function migrationStatePath(): string {
  return path.join(app.getPath('userData'), MIGRATION_STATE_FILE)
}

async function readMigrationState(): Promise<MigrationState | null> {
  try {
    const state = JSON.parse(await readFile(migrationStatePath(), 'utf8')) as MigrationState
    return typeof state?.status === 'string' ? state : null
  } catch {
    return null
  }
}

async function writeMigrationState(status: MigrationStatus): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    migrationStatePath(),
    `${JSON.stringify({ status, completedAt: new Date().toISOString() })}\n`,
    'utf8',
  )
}

function createMigrationWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: BACKGROUND_MIGRATION_WINDOW_TITLE,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

async function execute<T>(window: BrowserWindow, script: string): Promise<T> {
  return window.webContents.executeJavaScript(script, true) as Promise<T>
}

const hasWorkspaceFilesScript = `
  (async () => {
    const root = await navigator.storage.getDirectory()
    try {
      const workspace = await root.getDirectoryHandle('${WORKSPACE_DIRECTORY}')
      for await (const _entry of workspace.values()) return true
      return false
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false
      throw error
    }
  })()
`

const clearWorkspaceScript = `
  (async () => {
    const root = await navigator.storage.getDirectory()
    try {
      await root.removeEntry('${WORKSPACE_DIRECTORY}', { recursive: true })
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
    }
  })()
`

const listLegacyWorkspaceScript = `
  (async () => {
    const root = await navigator.storage.getDirectory()
    let workspace
    try {
      workspace = await root.getDirectoryHandle('${WORKSPACE_DIRECTORY}')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return []
      throw error
    }

    const files = []
    async function visit(directory, parentPath) {
      for await (const [name, entry] of directory.entries()) {
        const entryPath = [...parentPath, name]
        if (entry.kind === 'directory') {
          await visit(entry, entryPath)
          continue
        }
        const file = await entry.getFile()
        files.push({ path: entryPath, size: file.size })
      }
    }

    await visit(workspace, [])
    return files
  })()
`

function readLegacyChunkScript(file: WorkspaceFile, offset: number, length: number): string {
  return `
    (async () => {
      const root = await navigator.storage.getDirectory()
      let directory = await root.getDirectoryHandle('${WORKSPACE_DIRECTORY}')
      const segments = ${JSON.stringify(file.path)}
      for (const segment of segments.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment)
      }
      const handle = await directory.getFileHandle(segments.at(-1))
      const source = await handle.getFile()
      const chunk = source.slice(${offset}, ${offset + length})
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '')
          resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
        }
        reader.onerror = () => reject(reader.error ?? new Error('无法读取旧项目文件'))
        reader.readAsDataURL(chunk)
      })
    })()
  `
}

function writeTargetChunkScript(file: WorkspaceFile, offset: number, base64: string): string {
  return `
    (async () => {
      const root = await navigator.storage.getDirectory()
      let directory = await root.getDirectoryHandle('${WORKSPACE_DIRECTORY}', { create: true })
      const segments = ${JSON.stringify(file.path)}
      for (const segment of segments.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment, { create: true })
      }
      const handle = await directory.getFileHandle(segments.at(-1), { create: true })
      const writable = await handle.createWritable({ keepExistingData: true })
      try {
        if (${offset} === 0) await writable.truncate(${file.size})
        const binary = atob(${JSON.stringify(base64)})
        if (binary.length > 0) {
          const bytes = new Uint8Array(binary.length)
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
          await writable.write({ type: 'write', position: ${offset}, data: bytes })
        }
      } finally {
        await writable.close()
      }
    })()
  `
}

async function copyFiles(legacyWindow: BrowserWindow, targetWindow: BrowserWindow, files: WorkspaceFile[]): Promise<void> {
  for (const file of files) {
    const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const offset = chunkIndex * CHUNK_SIZE
      const length = Math.min(CHUNK_SIZE, Math.max(0, file.size - offset))
      const base64 = await execute<string>(legacyWindow, readLegacyChunkScript(file, offset, length))
      await execute<void>(targetWindow, writeTargetChunkScript(file, offset, base64))
    }
  }
}

function isTerminalState(state: MigrationState | null): boolean {
  return state?.status === 'complete'
    || state?.status === 'no-legacy-workspace'
    || state?.status === 'target-already-initialized'
}

/**
 * Move the first built-app FreeCut workspace from Electron's legacy file
 * origin into the stable luna://app origin. The source and destination never
 * coexist in a renderer, so origin isolation remains intact during migration.
 */
export async function migrateLegacyFreecutWorkspace(rendererDist: string): Promise<void> {
  const state = await readMigrationState()
  if (isTerminalState(state)) return

  const targetWindow = createMigrationWindow()
  let legacyWindow: BrowserWindow | undefined
  try {
    await targetWindow.loadURL('luna://app/index.html')
    const targetHasFiles = await execute<boolean>(targetWindow, hasWorkspaceFilesScript)
    if (state?.status === 'copying') {
      await execute<void>(targetWindow, clearWorkspaceScript)
    } else if (targetHasFiles) {
      await writeMigrationState('target-already-initialized')
      return
    }

    legacyWindow = createMigrationWindow()
    await legacyWindow.loadURL(pathToFileURL(path.join(rendererDist, 'index.html')).toString())
    const files = await execute<WorkspaceFile[]>(legacyWindow, listLegacyWorkspaceScript)
    if (files.length === 0) {
      await writeMigrationState('no-legacy-workspace')
      return
    }

    await writeMigrationState('copying')
    await copyFiles(legacyWindow, targetWindow, files)
    await writeMigrationState('complete')
  } finally {
    if (legacyWindow && !legacyWindow.isDestroyed()) legacyWindow.destroy()
    if (!targetWindow.isDestroyed()) targetWindow.destroy()
  }
}

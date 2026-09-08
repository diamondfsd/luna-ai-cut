import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import type { AiEditorFileDialogOptions, AiEditorFileFilter } from '../../src/shared/types'
import { revealFile } from '../storage/systemFileService'
import { getSettings } from '../storage/fileService'
import { loadWorkspaceEditorDocument, saveWorkspaceEditorDocument } from '../features/workspace/workspaceProjectService'

interface OpenWriteHandle {
  filePath: string
  handle: FileHandle
}

const writeHandles = new Map<string, OpenWriteHandle>()

function absoluteFilePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
    throw new Error(`${label}路径无效`)
  }
  return path.resolve(value)
}

function dialogFilters(value: unknown): Electron.FileFilter[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: AiEditorFileFilter) => {
    if (!item || typeof item.name !== 'string' || !Array.isArray(item.extensions)) return []
    const extensions = item.extensions.filter((extension): extension is string => (
      typeof extension === 'string' && /^[a-z0-9]+$/i.test(extension)
    ))
    return extensions.length > 0 ? [{ name: item.name, extensions }] : []
  })
}

function dialogOwner(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner && !owner.isDestroyed() ? owner : undefined
}

function byteBuffer(data: unknown): Buffer {
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  throw new Error('写入数据无效')
}

function writePosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('写入位置无效')
  }
  return value
}

function temporaryExtension(value: unknown): string {
  if (typeof value !== 'string') return 'bin'
  const extension = value.replace(/^\.+/, '').replace(/[^a-z0-9_-]/gi, '').slice(0, 12)
  return extension || 'bin'
}

async function closeWriteHandle(handleId: string, removeFile: boolean): Promise<void> {
  const entry = writeHandles.get(handleId)
  if (!entry) return
  writeHandles.delete(handleId)
  await entry.handle.close().catch(() => undefined)
  if (removeFile) await rm(entry.filePath, { force: true }).catch(() => undefined)
}

export function register(): void {
  ipcMain.handle('ai-editor:load-project', async (_event, projectId: string) => {
    const settings = await getSettings()
    return loadWorkspaceEditorDocument(settings.baseDir, projectId)
  })

  ipcMain.handle('ai-editor:save-project', async (_event, projectId: string, editorDocument: string) => {
    const settings = await getSettings()
    await saveWorkspaceEditorDocument(settings.baseDir, projectId, editorDocument)
  })

  ipcMain.handle('ai-editor:show-save-dialog', async (event, options: AiEditorFileDialogOptions) => {
    const dialogOptions: Electron.SaveDialogOptions = {
      defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
      filters: dialogFilters(options?.filters),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const owner = dialogOwner(event)
    const result = owner
      ? await dialog.showSaveDialog(owner, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    return result.canceled || !result.filePath ? null : result.filePath
  })

  ipcMain.handle('ai-editor:show-open-dialog', async (event, options: AiEditorFileDialogOptions) => {
    const dialogOptions: Electron.OpenDialogOptions = {
      filters: dialogFilters(options?.filters),
      properties: ['openFile'],
    }
    const owner = dialogOwner(event)
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('ai-editor:read-file', (_event, filePath: string) => (
    readFile(absoluteFilePath(filePath, '文件'), 'utf8')
  ))

  ipcMain.handle('ai-editor:read-file-bytes', async (_event, filePath: string) => {
    const bytes = await readFile(absoluteFilePath(filePath, '文件'))
    return Uint8Array.from(bytes).buffer
  })

  ipcMain.handle('ai-editor:temp-file-path', async (_event, extension: string) => {
    const directory = path.join(app.getPath('temp'), 'luna-openreel')
    await mkdir(directory, { recursive: true })
    return path.join(directory, `openreel-${randomUUID()}.${temporaryExtension(extension)}`)
  })

  ipcMain.handle('ai-editor:write-file', async (_event, filePath: string, data: string) => {
    const target = absoluteFilePath(filePath, '文件')
    if (typeof data !== 'string') throw new Error('写入内容无效')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data, { encoding: 'utf8', mode: 0o600 })
  })

  ipcMain.handle('ai-editor:open-write', async (_event, filePath: string) => {
    const target = absoluteFilePath(filePath, '文件')
    await mkdir(path.dirname(target), { recursive: true })
    const handle = await open(target, 'w', 0o600)
    const handleId = randomUUID()
    writeHandles.set(handleId, { filePath: target, handle })
    return handleId
  })

  ipcMain.handle('ai-editor:write-chunk', async (_event, handleId: string, data: ArrayBuffer | Uint8Array, position: number) => {
    const entry = writeHandles.get(handleId)
    if (!entry) throw new Error('写入任务已结束')
    const bytes = byteBuffer(data)
    const start = writePosition(position)
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await entry.handle.write(bytes, offset, bytes.byteLength - offset, start + offset)
      if (result.bytesWritten <= 0) throw new Error('文件写入失败')
      offset += result.bytesWritten
    }
  })

  ipcMain.handle('ai-editor:close-write', (_event, handleId: string) => closeWriteHandle(handleId, false))
  ipcMain.handle('ai-editor:abort-write', (_event, handleId: string) => closeWriteHandle(handleId, true))
  ipcMain.handle('ai-editor:reveal-in-folder', (_event, filePath: string) => revealFile(absoluteFilePath(filePath, '文件')))

  app.on('before-quit', () => {
    const pending = [...writeHandles.keys()].map((handleId) => closeWriteHandle(handleId, true))
    void Promise.all(pending)
  })
}

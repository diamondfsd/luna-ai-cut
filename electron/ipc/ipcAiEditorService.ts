import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import type { AiEditorFileDialogOptions, AiEditorFileFilter } from '../../src/shared/types'
import { revealFile } from '../storage/systemFileService'
import { getSettings } from '../storage/fileService'
import {
  createAiEditorProject,
  deleteAiEditorProject,
  listAiEditorProjects,
  loadAiEditorProject,
  renameAiEditorProject,
  saveAiEditorProject,
} from '../features/ai-editor/aiEditorProjectService'
import { logMainError, logMainInfo } from '../infrastructure/loggerService'

interface OpenWriteHandle {
  filePath: string
  handle: FileHandle
}

const writeHandles = new Map<string, OpenWriteHandle>()

function editorDocumentSummary(editorDocument: string): {
  documentBytes: number
  mediaCount?: number
  sourcePathCount?: number
} {
  const summary = { documentBytes: Buffer.byteLength(editorDocument, 'utf8') }
  try {
    const document = JSON.parse(editorDocument) as {
      mediaLibrary?: { items?: Array<{ sourcePath?: unknown }> }
    }
    const items = document.mediaLibrary?.items
    if (!Array.isArray(items)) return summary
    return {
      ...summary,
      mediaCount: items.length,
      sourcePathCount: items.filter((item) => typeof item?.sourcePath === 'string').length,
    }
  } catch {
    return summary
  }
}

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
  ipcMain.handle('ai-editor:list-projects', async () => {
    const settings = await getSettings()
    const projects = await listAiEditorProjects(settings.baseDir)
    return projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }))
  })

  ipcMain.handle('ai-editor:create-project', async (_event, name: string, assets: import('../../src/shared/types').WorkspaceMediaAsset[] = []) => {
    const settings = await getSettings()
    const project = await createAiEditorProject(settings.baseDir, name, assets)
    return {
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
  })

  ipcMain.handle('ai-editor:load-project', async (_event, projectId: string) => {
    try {
      const settings = await getSettings()
      const snapshot = await loadAiEditorProject(settings.baseDir, projectId)
      logMainInfo('[AI 剪辑] 加载项目完成', {
        projectId,
        hasEditorDocument: Boolean(snapshot.editorDocument),
        ...(snapshot.editorDocument ? editorDocumentSummary(snapshot.editorDocument) : {}),
      })
      return snapshot
    } catch (error) {
      logMainError('[AI 剪辑] 加载项目失败', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  ipcMain.handle('ai-editor:save-project', async (_event, projectId: string, editorDocument: string) => {
    try {
      const settings = await getSettings()
      await saveAiEditorProject(settings.baseDir, projectId, editorDocument)
      logMainInfo('[AI 剪辑] 保存项目完成', { projectId, ...editorDocumentSummary(editorDocument) })
    } catch (error) {
      logMainError('[AI 剪辑] 保存项目失败', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  ipcMain.handle('ai-editor:delete-project', async (_event, projectId: string) => {
    try {
      const settings = await getSettings()
      await deleteAiEditorProject(settings.baseDir, projectId)
      logMainInfo('[AI 剪辑] 删除项目完成', { projectId })
    } catch (error) {
      logMainError('[AI 剪辑] 删除项目失败', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  ipcMain.handle('ai-editor:rename-project', async (_event, projectId: string, name: string) => {
    const settings = await getSettings()
    const project = await renameAiEditorProject(settings.baseDir, projectId, name)
    return {
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
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

  ipcMain.handle('ai-editor:read-file', async (_event, filePath: string) => {
    try {
      const target = absoluteFilePath(filePath, '文件')
      const content = await readFile(target, 'utf8')
      logMainInfo('[AI 剪辑] 读取文件完成', { fileName: path.basename(target), bytes: Buffer.byteLength(content, 'utf8') })
      return content
    } catch (error) {
      logMainError('[AI 剪辑] 读取文件失败', {
        fileName: typeof filePath === 'string' ? path.basename(filePath) : undefined,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  ipcMain.handle('ai-editor:read-file-bytes', async (_event, filePath: string) => {
    try {
      const target = absoluteFilePath(filePath, '文件')
      const bytes = await readFile(target)
      logMainInfo('[AI 剪辑] 读取素材完成', { fileName: path.basename(target), bytes: bytes.byteLength })
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    } catch (error) {
      logMainError('[AI 剪辑] 读取素材失败', {
        fileName: typeof filePath === 'string' ? path.basename(filePath) : undefined,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
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

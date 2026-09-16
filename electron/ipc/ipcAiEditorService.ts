import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import type {
  AiEditorFileDialogOptions,
  AiEditorFileFilter,
  AiEditorLocalMediaContactSheetOptions,
  AiEditorLocalMediaInspectionOptions,
  AiEditorLocalMediaQuery,
} from '../../src/shared/types'
import { revealFile } from '../storage/systemFileService'
import { getSettings } from '../storage/fileService'
import {
  getAiEditorLocalMedia,
  listAiEditorLocalMedia,
  readAiEditorLocalMediaBytes,
} from '../features/ai-editor/aiEditorLocalMediaService'
import { getAiEditorLocalMediaMetadata } from '../features/ai-editor/aiEditorMediaMetadataService'
import { createAiEditorLocalMediaContactSheet, inspectAiEditorLocalMedia } from '../features/ai-editor/aiEditorMediaAnalysisService'
import { transcribeAiEditorAudioSamples, transcribeAiEditorLocalMedia } from '../features/ai-editor/aiEditorSpeechService'
import {
  createAiEditorProject,
  deleteAiEditorProject,
  listAiEditorProjects,
  loadAiEditorProject,
  renameAiEditorProject,
  saveAiEditorProject,
} from '../features/ai-editor/aiEditorProjectService'
import { logMainError, logMainInfo, logOpenReelMessage } from '../infrastructure/loggerService'

interface OpenWriteHandle {
  filePath: string
  handle: FileHandle
  bytesWritten: number
}

const writeHandles = new Map<string, OpenWriteHandle>()

function logAiEditorInfo(message: string, meta?: unknown): void {
  logMainInfo(message, meta)
  logOpenReelMessage('INFO', message, meta)
}

function logAiEditorError(message: string, meta?: unknown): void {
  logMainError(message, meta)
  logOpenReelMessage('ERROR', message, meta)
}

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
  const fileName = path.basename(entry.filePath)
  try {
    await entry.handle.close()
    if (removeFile) {
      await rm(entry.filePath, { force: true })
      logAiEditorInfo('[AI 剪辑] 导出文件已取消', { fileName, bytes: entry.bytesWritten })
      return
    }
    const file = await stat(entry.filePath)
    logAiEditorInfo('[AI 剪辑] 导出文件写入完成', {
      fileName,
      bytesWritten: entry.bytesWritten,
      fileBytes: file.size,
    })
  } catch (error) {
    if (removeFile) await rm(entry.filePath, { force: true }).catch(() => undefined)
    logAiEditorError('[AI 剪辑] 导出文件写入失败', {
      fileName,
      bytesWritten: entry.bytesWritten,
      error: error instanceof Error ? error.message : String(error),
    })
    if (!removeFile) throw error
  }
}

export function register(): void {
  ipcMain.handle('ai-editor:list-local-media', async (_event, query: AiEditorLocalMediaQuery = {}) => {
    return listAiEditorLocalMedia(query)
  })

  ipcMain.handle('ai-editor:get-local-media', async (_event, mediaId: string) => {
    const media = await getAiEditorLocalMedia(mediaId)
    const publicMedia = { ...media }
    Reflect.deleteProperty(publicMedia, 'filePath')
    return publicMedia
  })

  ipcMain.handle('ai-editor:get-local-media-metadata', async (_event, mediaIds: string[]) => {
    return getAiEditorLocalMediaMetadata(mediaIds)
  })

  ipcMain.handle('ai-editor:read-local-media-bytes', (_event, mediaId: string) => {
    return readAiEditorLocalMediaBytes(mediaId)
  })

  ipcMain.handle('ai-editor:inspect-local-media', async (_event, mediaIds: string[], options: AiEditorLocalMediaInspectionOptions = {}) => {
    return inspectAiEditorLocalMedia(mediaIds, options)
  })

  ipcMain.handle('ai-editor:create-media-contact-sheet', async (_event, mediaIds: string[], options: AiEditorLocalMediaContactSheetOptions = {}) => {
    return createAiEditorLocalMediaContactSheet(mediaIds, options)
  })

  ipcMain.handle('ai-editor:transcribe-local-media', async (_event, mediaId: string, options = {}) => {
    return transcribeAiEditorLocalMedia(mediaId, options)
  })

  ipcMain.handle('ai-editor:transcribe-audio-samples', async (_event, samples: Float32Array, options = {}) => {
    return transcribeAiEditorAudioSamples(samples, options)
  })

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
      logAiEditorInfo('[AI 剪辑] 加载项目完成', {
        projectId,
        hasEditorDocument: Boolean(snapshot.editorDocument),
        ...(snapshot.editorDocument ? editorDocumentSummary(snapshot.editorDocument) : {}),
      })
      return snapshot
    } catch (error) {
      logAiEditorError('[AI 剪辑] 加载项目失败', {
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
      logAiEditorInfo('[AI 剪辑] 保存项目完成', { projectId, ...editorDocumentSummary(editorDocument) })
    } catch (error) {
      logAiEditorError('[AI 剪辑] 保存项目失败', {
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
      logAiEditorInfo('[AI 剪辑] 删除项目完成', { projectId })
    } catch (error) {
      logAiEditorError('[AI 剪辑] 删除项目失败', {
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
    const filePath = result.canceled || !result.filePath ? null : result.filePath
    logAiEditorInfo('[AI 剪辑] 导出位置已选择', {
      fileName: filePath ? path.basename(filePath) : null,
      canceled: result.canceled,
    })
    return filePath
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
      logAiEditorInfo('[AI 剪辑] 读取文件完成', { fileName: path.basename(target), bytes: Buffer.byteLength(content, 'utf8') })
      return content
    } catch (error) {
      logAiEditorError('[AI 剪辑] 读取文件失败', {
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
      logAiEditorInfo('[AI 剪辑] 读取素材完成', { fileName: path.basename(target), bytes: bytes.byteLength })
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    } catch (error) {
      logAiEditorError('[AI 剪辑] 读取素材失败', {
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
    const fileName = typeof filePath === 'string' ? path.basename(filePath) : undefined
    try {
      const target = absoluteFilePath(filePath, '文件')
      await mkdir(path.dirname(target), { recursive: true })
      let overwriting = false
      try {
        overwriting = (await stat(target)).isFile()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const handle = await open(target, 'w', 0o600)
      const handleId = randomUUID()
      writeHandles.set(handleId, { filePath: target, handle, bytesWritten: 0 })
      logAiEditorInfo('[AI 剪辑] 开始写入导出文件', { fileName: path.basename(target), overwriting })
      return handleId
    } catch (error) {
      logAiEditorError('[AI 剪辑] 打开导出文件失败', {
        fileName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
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
      entry.bytesWritten += result.bytesWritten
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

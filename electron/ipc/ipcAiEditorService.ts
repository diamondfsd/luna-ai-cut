import { BrowserWindow, dialog, ipcMain } from 'electron'

import type { AiEditorLocalMediaContactSheetOptions, AiEditorLocalMediaInspectionOptions, AiEditorLocalMediaQuery } from '../../src/shared/types'
import type { LunaEditProject, FootageSelectionProject } from '../../src/shared/types/aiEditing.ts'
import { getSettings } from '../storage/fileService'
import {
  getAiEditorLocalMedia,
  listAiEditorLocalMedia,
  readAiEditorLocalMediaBytes,
  resolveAiEditorLocalMediaPaths,
} from '../features/ai-editor/aiEditorLocalMediaService.ts'
import { getAiEditorLocalMediaMetadata } from '../features/ai-editor/aiEditorMediaMetadataService.ts'
import { createAiEditorLocalMediaContactSheet, inspectAiEditorLocalMedia } from '../features/ai-editor/aiEditorMediaAnalysisService.ts'
import { transcribeAiEditorAudioSamples, transcribeAiEditorLocalMedia } from '../features/ai-editor/aiEditorSpeechService.ts'
import {
  addAiEditorProjectMedia,
  createAiEditorProject,
  deleteAiEditorProject,
  listAiEditorProjects,
  loadAiEditorProject,
  renameAiEditorProject,
  saveAiEditorProject,
} from '../features/ai-editor/aiEditorProjectService.ts'
import {
  createFootageSelectionProject,
  deleteFootageSelectionProject,
  listFootageSelectionProjects,
  loadFootageSelectionProject,
  saveFootageSelectionProject,
} from '../features/ai-editor/footageSelectionService.ts'
import { exportAiEditorProject, listAiEditorFilters, listAiEditorWatermarks } from '../features/ai-editor/aiEditorExportService.ts'
import { logMainError, logMainInfo } from '../infrastructure/loggerService'

function summaryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function register(): void {
  ipcMain.handle('ai-editor:open-window', async (event, mediaIds: unknown = []) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed()) throw new Error('主窗口不可用')
    if (!Array.isArray(mediaIds) || mediaIds.length > 500 || mediaIds.some(id => typeof id !== 'string')) throw new Error('素材列表无效')
    const settings = await getSettings()
    let project: Awaited<ReturnType<typeof createAiEditorProject>> | null = null
    if (mediaIds.length > 0) {
      project = await createAiEditorProject(settings.baseDir, 'AI 剪辑项目')
      try {
        await addAiEditorProjectMedia(settings.baseDir, project.projectId, mediaIds)
      } catch (error) {
        await deleteAiEditorProject(settings.baseDir, project.projectId).catch(() => undefined)
        throw error
      }
    }
    owner.webContents.send('ai-editor:open-project', project?.projectId ?? null)
    logMainInfo('[AI 剪辑] 打开工作台', { projectId: project?.projectId ?? null, sourceCount: mediaIds.length })
  })
  ipcMain.handle('ai-editor:resolve-media-paths', (_event, paths: string[]) => resolveAiEditorLocalMediaPaths(paths))
  ipcMain.handle('ai-editor:export-project', async (event, projectId: string) => {
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('剪辑工程编号无效')
    const settings = await getSettings()
    const { project } = await loadAiEditorProject(settings.baseDir, projectId)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Luna-剪辑'
    const defaultPath = `${safeName}.mp4`
    const result = owner && !owner.isDestroyed()
      ? await dialog.showSaveDialog(owner, { defaultPath, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
      : await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
    if (result.canceled || !result.filePath) return null
    return exportAiEditorProject(settings.baseDir, projectId, result.filePath)
  })
  ipcMain.handle('ai-editor:list-filters', () => listAiEditorFilters())
  ipcMain.handle('ai-editor:list-watermarks', () => listAiEditorWatermarks())
  ipcMain.handle('ai-editor:list-local-media', (_event, query: AiEditorLocalMediaQuery = {}) => listAiEditorLocalMedia(query))
  ipcMain.handle('ai-editor:get-local-media', async (_event, mediaId: string) => {
    const media = await getAiEditorLocalMedia(mediaId)
    const publicMedia = { ...media }
    Reflect.deleteProperty(publicMedia, 'filePath')
    return { ...publicMedia, sourcePath: media.filePath }
  })
  ipcMain.handle('ai-editor:get-local-media-metadata', (_event, mediaIds: string[]) => getAiEditorLocalMediaMetadata(mediaIds))
  ipcMain.handle('ai-editor:read-local-media-bytes', (_event, mediaId: string) => readAiEditorLocalMediaBytes(mediaId))
  ipcMain.handle('ai-editor:inspect-local-media', (_event, mediaIds: string[], options: AiEditorLocalMediaInspectionOptions = {}) => inspectAiEditorLocalMedia(mediaIds, options))
  ipcMain.handle('ai-editor:create-media-contact-sheet', (_event, mediaIds: string[], options: AiEditorLocalMediaContactSheetOptions = {}) => createAiEditorLocalMediaContactSheet(mediaIds, options))
  ipcMain.handle('ai-editor:transcribe-local-media', (_event, mediaId: string, options = {}) => transcribeAiEditorLocalMedia(mediaId, options))
  ipcMain.handle('ai-editor:transcribe-audio-samples', (_event, samples: Float32Array, options = {}) => transcribeAiEditorAudioSamples(samples, options))

  ipcMain.handle('ai-editor:list-projects', async () => listAiEditorProjects((await getSettings()).baseDir))
  ipcMain.handle('ai-editor:create-project', async (_event, name: string) => createAiEditorProject((await getSettings()).baseDir, name))
  ipcMain.handle('ai-editor:load-project', async (_event, projectId: string) => {
    try {
      return await loadAiEditorProject((await getSettings()).baseDir, projectId)
    } catch (error) {
      logMainError('[AI 剪辑] 加载工程失败', { projectId, error: summaryError(error) })
      throw error
    }
  })
  ipcMain.handle('ai-editor:save-project', async (_event, project: LunaEditProject, expectedRevision: number, taskId?: string) => {
    try {
      return await saveAiEditorProject((await getSettings()).baseDir, project, expectedRevision, taskId)
    } catch (error) {
      logMainError('[AI 剪辑] 保存工程失败', { projectId: project?.id, error: summaryError(error) })
      throw error
    }
  })
  ipcMain.handle('ai-editor:add-media', async (_event, projectId: string, mediaIds: string[]) => addAiEditorProjectMedia((await getSettings()).baseDir, projectId, mediaIds))
  ipcMain.handle('ai-editor:delete-project', async (_event, projectId: string) => deleteAiEditorProject((await getSettings()).baseDir, projectId))
  ipcMain.handle('ai-editor:rename-project', async (_event, projectId: string, name: string) => renameAiEditorProject((await getSettings()).baseDir, projectId, name))

  ipcMain.handle('footage-selection:list', async () => listFootageSelectionProjects((await getSettings()).baseDir))
  ipcMain.handle('footage-selection:create', async (_event, name: string, mediaIds: string[] = []) => createFootageSelectionProject((await getSettings()).baseDir, name, mediaIds))
  ipcMain.handle('footage-selection:load', async (_event, projectId: string) => loadFootageSelectionProject((await getSettings()).baseDir, projectId))
  ipcMain.handle('footage-selection:save', async (_event, project: FootageSelectionProject, expectedRevision: number) => saveFootageSelectionProject((await getSettings()).baseDir, project, expectedRevision))
  ipcMain.handle('footage-selection:delete', async (_event, projectId: string) => deleteFootageSelectionProject((await getSettings()).baseDir, projectId))
}

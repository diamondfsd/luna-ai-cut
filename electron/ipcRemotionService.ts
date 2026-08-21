import { ipcMain } from 'electron'
import type {
  RemotionClipCreateInput,
  RemotionSceneSpec,
  RemotionSourceUpdateRequest,
} from '../src/shared/types/remotion'
import {
  cancelRemotionTask,
  executeRemotionCapability,
  getRemotionTask,
  startRemotionRender,
} from './remotionRenderService'
import {
  createRemotionClip,
  getRemotionClip,
  listRemotionClips,
  readRemotionSource,
  updateRemotionSource,
} from './remotionClipService'
import { currentBaseDir } from './settingsService'

export function register(): void {
  ipcMain.handle('remotion:start', (_event, scene: RemotionSceneSpec, projectId?: string) => startRemotionRender(scene, undefined, projectId))
  ipcMain.handle('remotion:get-task', (_event, taskId: string, projectId?: string) => getRemotionTask(taskId, undefined, projectId))
  ipcMain.handle('remotion:cancel', (_event, taskId: string, projectId?: string) => cancelRemotionTask(taskId, undefined, projectId))
  ipcMain.handle('remotion:create-clip', (_event, projectId: string, input?: RemotionClipCreateInput) => createRemotionClip(currentBaseDir(), projectId, input))
  ipcMain.handle('remotion:list-clips', (_event, projectId: string) => listRemotionClips(currentBaseDir(), projectId))
  ipcMain.handle('remotion:get-clip', (_event, projectId: string, clipId: string) => getRemotionClip(currentBaseDir(), projectId, clipId))
  ipcMain.handle('remotion:read-source', (_event, projectId: string, clipId: string) => readRemotionSource(currentBaseDir(), projectId, clipId))
  ipcMain.handle('remotion:update-source', (_event, request: RemotionSourceUpdateRequest) => updateRemotionSource(currentBaseDir(), request))
  ipcMain.handle('remotion:preview', (_event, projectId: string, clipId: string, expectedRevision?: number) => executeRemotionCapability('render.remotion.preview', { clipId, expectedRevision }, { projectId }, new AbortController().signal))
  ipcMain.handle('remotion:render', (_event, projectId: string, clipId: string, expectedRevision?: number) => executeRemotionCapability('render.remotion.render', { clipId, expectedRevision }, { projectId }, new AbortController().signal))
}

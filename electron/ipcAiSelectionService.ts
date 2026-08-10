import { dialog, ipcMain } from 'electron'

import type { AiSelectionStartRequest, AiSelectionUserOperation } from '../src/shared/types'
import type { IpcContext } from './ipcContext'
import {
  applyAiSelectionOperation,
  analyzeAiSelectionContentTags,
  analyzeAiSelectionPeople,
  analyzeAiSelectionVideos,
  cancelAiSelection,
  createProjectFromAiSelection,
  getAiSelectionSession,
  hideAiSelectionPerson,
  listAiSelectionHiddenPeople,
  listAiSelectionSessions,
  pauseAiSelection,
  mergeAiSelectionPeople,
  redoAiSelection,
  renameAiSelectionPerson,
  removeAiSelectionSession,
  resumeAiSelection,
  restoreAiSelectionPerson,
  setAiSelectionPersonAvatar,
  setAiSelectionFaceGroupingThreshold,
  setAiSelectionNotifier,
  startAiSelection,
  undoAiSelection,
  unmergeAiSelectionPerson,
} from './aiSelectionService'

export function register(ctx: IpcContext): void {
  setAiSelectionNotifier((event, payload) => {
    if (!ctx.win || ctx.win.isDestroyed()) return
    ctx.win.webContents.send(event === 'progress' ? 'ai-selection:progress' : 'ai-selection:session-updated', payload)
  })
  void listAiSelectionSessions().catch(() => undefined)

  ipcMain.handle('ai-selection:choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择需要 AI 选片的素材目录',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('ai-selection:start', (_event, request: AiSelectionStartRequest) => startAiSelection(request))
  ipcMain.handle('ai-selection:list', () => listAiSelectionSessions())
  ipcMain.handle('ai-selection:get', (_event, sessionId: string) => getAiSelectionSession(sessionId))
  ipcMain.handle('ai-selection:pause', (_event, sessionId: string) => pauseAiSelection(sessionId))
  ipcMain.handle('ai-selection:resume', (_event, sessionId: string) => resumeAiSelection(sessionId))
  ipcMain.handle('ai-selection:cancel', (_event, sessionId: string) => cancelAiSelection(sessionId))
  ipcMain.handle('ai-selection:apply-operation', (_event, sessionId: string, revision: number, operation: AiSelectionUserOperation) => applyAiSelectionOperation(sessionId, revision, operation))
  ipcMain.handle('ai-selection:analyze-people', (_event, sessionId: string, itemIds: string[]) => analyzeAiSelectionPeople(sessionId, itemIds))
  ipcMain.handle('ai-selection:set-face-grouping-threshold', (_event, sessionId: string, threshold: number) => setAiSelectionFaceGroupingThreshold(sessionId, threshold))
  ipcMain.handle('ai-selection:rename-person', (_event, sessionId: string, groupId: string, name: string) => renameAiSelectionPerson(sessionId, groupId, name))
  ipcMain.handle('ai-selection:set-person-avatar', (_event, sessionId: string, groupId: string, itemId: string, bounds: { x: number; y: number; width: number; height: number }) => setAiSelectionPersonAvatar(sessionId, groupId, itemId, bounds))
  ipcMain.handle('ai-selection:merge-people', (_event, sessionId: string, targetGroupId: string, sourceGroupIds: string[]) => mergeAiSelectionPeople(sessionId, targetGroupId, sourceGroupIds))
  ipcMain.handle('ai-selection:unmerge-person', (_event, sessionId: string, targetGroupId: string, memberIdentityId: string) => unmergeAiSelectionPerson(sessionId, targetGroupId, memberIdentityId))
  ipcMain.handle('ai-selection:hide-person', (_event, sessionId: string, groupId: string) => hideAiSelectionPerson(sessionId, groupId))
  ipcMain.handle('ai-selection:list-hidden-people', () => listAiSelectionHiddenPeople())
  ipcMain.handle('ai-selection:restore-person', (_event, sessionId: string, personId: string) => restoreAiSelectionPerson(sessionId, personId))
  ipcMain.handle('ai-selection:analyze-content-tags', (_event, sessionId: string, itemIds: string[]) => analyzeAiSelectionContentTags(sessionId, itemIds))
  ipcMain.handle('ai-selection:analyze-videos', (_event, sessionId: string, itemIds: string[]) => analyzeAiSelectionVideos(sessionId, itemIds))
  ipcMain.handle('ai-selection:undo', (_event, sessionId: string) => undoAiSelection(sessionId))
  ipcMain.handle('ai-selection:redo', (_event, sessionId: string) => redoAiSelection(sessionId))
  ipcMain.handle('ai-selection:create-project', (_event, sessionId: string, name: string) => createProjectFromAiSelection(sessionId, name))
  ipcMain.handle('ai-selection:remove', (_event, sessionId: string) => removeAiSelectionSession(sessionId))
}

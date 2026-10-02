import { BrowserWindow, ipcMain } from 'electron'

import type { AiEditorAgentSession } from '../../src/shared/types'
import { agentSessionManager } from '../mcp/agentSessionManager'
import type { IpcContext } from './context'

let registered = false

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requireRequest(value: unknown): string {
  const request = stringOrNull(value)
  if (!request) throw new Error('剪辑要求不能为空')
  return request
}

export function activateAgentWindow(context: IpcContext): void {
  const purpose = agentSessionManager.snapshot().session?.purpose
  if (purpose && purpose !== 'editing') return
  const window = context.win
  if (!window || window.isDestroyed()) throw new Error('Luna AI Cut 窗口不可用')
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send('ai-editor:agent-activate')
  }
}

export function register(context: IpcContext): void {
  if (registered) return
  registered = true

  agentSessionManager.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('ai-editor:agent-event', event)
    }
  })

  ipcMain.handle('ai-editor:agent-create-request', (_event, request: unknown, projectId: unknown) =>
    agentSessionManager.createRequest(requireRequest(request), stringOrNull(projectId)),
  )

  ipcMain.handle('ai-editor:agent-update-request', (_event, sessionId: unknown, request: unknown) => {
    const normalizedSessionId = stringOrNull(sessionId)
    if (!normalizedSessionId) throw new Error('剪辑任务不存在')
    return agentSessionManager.updateRequest(normalizedSessionId, requireRequest(request))
  })

  ipcMain.handle('ai-editor:agent-cancel-request', (_event, sessionId: unknown) => {
    const normalizedSessionId = stringOrNull(sessionId)
    if (!normalizedSessionId) throw new Error('剪辑任务不存在')
    return agentSessionManager.cancelRequest(normalizedSessionId)
  })

  ipcMain.handle('ai-editor:agent-confirm-export', (_event, sessionId: unknown) => {
    const normalizedSessionId = stringOrNull(sessionId)
    if (!normalizedSessionId) throw new Error('剪辑任务不存在')
    return agentSessionManager.confirmExport(normalizedSessionId)
  })

  ipcMain.handle('ai-editor:agent-deny-export', (_event, sessionId: unknown) => {
    const normalizedSessionId = stringOrNull(sessionId)
    if (!normalizedSessionId) throw new Error('剪辑任务不存在')
    return agentSessionManager.denyExport(normalizedSessionId)
  })

  ipcMain.handle('ai-editor:agent-snapshot', () => agentSessionManager.snapshot())

  ipcMain.handle('ai-editor:agent-activate-window', () => {
    activateAgentWindow(context)
    return true
  })
}

export function isAgentSession(value: unknown): value is AiEditorAgentSession {
  return Boolean(value && typeof value === 'object' && typeof (value as AiEditorAgentSession).sessionId === 'string')
}

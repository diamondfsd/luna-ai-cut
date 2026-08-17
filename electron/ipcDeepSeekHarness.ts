import { BrowserWindow, ipcMain } from 'electron'
import {
  cancelDeepSeekHarnessToolRequest,
  getDeepSeekHarnessWebUrl,
  onDeepSeekHarnessWebState,
  resolveDeepSeekHarnessToolResponse,
  setDeepSeekHarnessRenderer,
} from './deepseekHarnessService'

export function register(): void {
  onDeepSeekHarnessWebState((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('deepseek-harness:web-state', state)
    }
  })
  ipcMain.handle('deepseek-harness:get-web-url', (event, projectId: string) => {
    setDeepSeekHarnessRenderer(event.sender.id)
    return getDeepSeekHarnessWebUrl(projectId)
  })
  ipcMain.on('deepseek-harness:tool-response', (event, payload) => {
    if (!isToolResponse(payload)) return
    resolveDeepSeekHarnessToolResponse(event.sender.id, payload)
  })
  ipcMain.on('deepseek-harness:tool-cancel', (event, payload) => {
    if (!isToolCancel(payload)) return
    cancelDeepSeekHarnessToolRequest(event.sender.id, payload.requestId)
  })
}

function isToolResponse(value: unknown): value is {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
} {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return typeof payload.requestId === 'string'
    && payload.requestId.length > 0
    && typeof payload.ok === 'boolean'
    && (payload.error === undefined || typeof payload.error === 'string')
}

function isToolCancel(value: unknown): value is { requestId: string } {
  if (!value || typeof value !== 'object') return false
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128
}

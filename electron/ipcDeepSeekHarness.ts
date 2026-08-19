import { BrowserWindow, ipcMain } from 'electron'
import {
  closeDeepSeekHarnessWindow,
  getDeepSeekHarnessWebUrl,
  openDeepSeekHarnessWindow,
  onDeepSeekHarnessWebState,
} from './deepseekHarnessService'
import type { DeepSeekHarnessContext } from '../src/shared/types'

export function register(): void {
  onDeepSeekHarnessWebState((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('deepseek-harness:web-state', state)
    }
  })
  ipcMain.handle('deepseek-harness:open-window', () => openDeepSeekHarnessWindow())
  ipcMain.handle('deepseek-harness:close-window', () => closeDeepSeekHarnessWindow())
  ipcMain.handle('deepseek-harness:get-web-url', (_event, context: unknown) => {
    if (!isContext(context)) throw new Error('助手上下文无效。')
    return getDeepSeekHarnessWebUrl(context)
  })
}

function isContext(value: unknown): value is DeepSeekHarnessContext {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return typeof payload.sessionId === 'string'
    && payload.sessionId.length > 0
    && payload.sessionId.length <= 200
    && (payload.feature === undefined || typeof payload.feature === 'string')
    && (payload.projectId === undefined || typeof payload.projectId === 'string')
    && (payload.metadata === undefined || isMetadata(payload.metadata))
}

function isMetadata(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, item]) =>
    key.length <= 200 && typeof item === 'string' && item.length <= 200)
}

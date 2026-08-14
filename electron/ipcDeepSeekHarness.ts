import { BrowserWindow, ipcMain } from 'electron'
import type { EmbeddedDeepSeekHarnessConfigInput } from '../packages/freecut-editor/src/shared/host/deepseek-harness'
import {
  getDeepSeekHarnessPublicConfig,
  getDeepSeekHarnessWebUrl,
  onDeepSeekHarnessWebState,
  resolveDeepSeekHarnessSourceToolResponse,
  saveDeepSeekHarnessPublicConfig,
  setDeepSeekHarnessRenderer,
  testDeepSeekHarnessPublicConfig,
} from './deepseekHarnessService'

export function register(): void {
  onDeepSeekHarnessWebState((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('deepseek-harness:web-state', state)
    }
  })
  ipcMain.handle('deepseek-harness:get-config', (event) => {
    setDeepSeekHarnessRenderer(event.sender.id)
    return getDeepSeekHarnessPublicConfig()
  })
  ipcMain.handle('deepseek-harness:save-config', (event, input: EmbeddedDeepSeekHarnessConfigInput) => {
    setDeepSeekHarnessRenderer(event.sender.id)
    return saveDeepSeekHarnessPublicConfig(input)
  })
  ipcMain.handle('deepseek-harness:test-config', (event, input: EmbeddedDeepSeekHarnessConfigInput) => {
    setDeepSeekHarnessRenderer(event.sender.id)
    return testDeepSeekHarnessPublicConfig(input)
  })
  ipcMain.handle('deepseek-harness:get-web-url', (event, projectId: string) => {
    setDeepSeekHarnessRenderer(event.sender.id)
    return getDeepSeekHarnessWebUrl(projectId)
  })
  ipcMain.on('deepseek-harness:source-tool-response', (event, payload) => {
    if (!isSourceToolResponse(payload)) return
    resolveDeepSeekHarnessSourceToolResponse(event.sender.id, payload)
  })
}

function isSourceToolResponse(value: unknown): value is {
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

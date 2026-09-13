import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AiEditorMcpRequest, AiEditorMcpResponse } from '../../src/shared/types'
import type { IpcContext } from './context'
import { createLunaMcpServer, type LunaMcpServer } from '../mcp/lunaMcpServer'

interface PendingRendererRequest {
  resolve: (response: AiEditorMcpResponse) => void
  timer: NodeJS.Timeout
}

const MCP_RENDERER_REQUEST_TIMEOUT_MS = 15 * 60 * 1_000
let registered = false
let mcpServer: LunaMcpServer | null = null
const pending = new Map<string, PendingRendererRequest>()

function requestRenderer(context: IpcContext, request: AiEditorMcpRequest): Promise<AiEditorMcpResponse> {
  const window = context.win
  if (!window || window.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'AI 剪辑窗口未打开' })
  }

  return new Promise((resolve) => {
    const callId = request.callId || randomUUID()
    const timer = setTimeout(() => {
      pending.delete(callId)
      resolve({ ok: false, error: 'AI 剪辑响应超时，请确认项目已打开' })
    }, MCP_RENDERER_REQUEST_TIMEOUT_MS)
    pending.set(callId, { resolve, timer })
    window.webContents.send('ai-editor:mcp-request', { ...request, callId })
  })
}

export function register(context: IpcContext): void {
  if (registered) return
  registered = true

  ipcMain.handle('ai-editor:mcp-launcher-path', () => {
    if (app.isPackaged) return null
    return path.join(app.getAppPath(), 'scripts', 'luna-mcp.mjs')
  })

  ipcMain.on('ai-editor:mcp-response', (event, callId: unknown, response: unknown) => {
    if (event.sender !== context.win?.webContents || typeof callId !== 'string') return
    const request = pending.get(callId)
    if (!request) return
    pending.delete(callId)
    clearTimeout(request.timer)
    if (!response || typeof response !== 'object') {
      request.resolve({ ok: false, error: 'AI 剪辑返回了无效结果' })
      return
    }
    request.resolve(response as AiEditorMcpResponse)
  })

  mcpServer = createLunaMcpServer({
    homeDir: process.env.LUNA_E2E_USER_DATA_DIR ?? app.getPath('home'),
    requestRenderer: (request) => requestRenderer(context, request),
  })
  void mcpServer.start().catch((error: unknown) => {
    console.error('[MCP] 本机服务启动失败', error)
  })

  app.once('will-quit', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.resolve({ ok: false, error: '应用正在退出' })
    }
    pending.clear()
    void mcpServer?.stop()
  })
}

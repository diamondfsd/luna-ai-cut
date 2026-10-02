import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AiEditorMcpRequest, AiEditorMcpResponse } from '../../src/shared/types'
import type { IpcContext } from './context'
import { createLunaMcpServer, type LunaMcpServer } from '../mcp/lunaMcpServer'
import {
  generateBackgroundMusic,
  getMusicTemplate,
  listMusicTemplates,
} from '../features/music/musicGenerationService.ts'
import { activateAgentWindow } from './ipcAiEditorAgentService'
import { getAiEditorWindow } from './ipcAiEditorService'
import { agentSessionManager } from '../mcp/agentSessionManager'
import { createDirectorPlanAgentService } from '../features/director-lab/directorPlanAgentService'
import { getDirectorPlanDir, getSettings } from '../storage/fileService'
import { agentPersonalSpace } from '../features/agent-space/agentPersonalSpace.ts'
import { createMemoryRepository } from '../features/memory/memoryRepository.ts'
import { createMemoryService } from '../features/memory/memoryService.ts'
import { createMemoryToolModule } from '../features/memory/memoryToolModule.ts'

interface PendingRendererRequest {
  resolve: (response: AiEditorMcpResponse) => void
  timer: NodeJS.Timeout
}

const MCP_RENDERER_REQUEST_TIMEOUT_MS = 15 * 60 * 1_000
let registered = false
let mcpServer: LunaMcpServer | null = null
const pending = new Map<string, PendingRendererRequest>()

function requestRenderer(request: AiEditorMcpRequest): Promise<AiEditorMcpResponse> {
  const editorWindow = getAiEditorWindow()
  // No editor means no bridge for any editor operation. Never wait on the library window.
  if (!editorWindow) {
    return Promise.resolve({ ok: false, error: 'AI 剪辑窗口未打开' })
  }
  const window = editorWindow
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

export async function getAgentHttpConnection() {
  if (!mcpServer) throw new Error('暂时无法连接，请重试')
  const endpoint = await mcpServer.getEndpoint()
  return { ...endpoint, discoveryPath: mcpServer.endpointPath }
}

export function register(context: IpcContext): void {
  if (registered) return
  registered = true

  ipcMain.handle('ai-editor:mcp-launcher-path', () => {
    if (app.isPackaged) return null
    return path.join(app.getAppPath(), 'scripts', 'luna-mcp.mjs')
  })

  ipcMain.handle('ai-editor:mcp-http-connection', getAgentHttpConnection)

  ipcMain.on('ai-editor:mcp-response', (_event, callId: unknown, response: unknown) => {
    if (typeof callId !== 'string') return
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

  const homeDir = process.env.LUNA_E2E_USER_DATA_DIR ?? app.getPath('home')
  const space = agentPersonalSpace(homeDir)
  const memory = createMemoryService(createMemoryRepository(async () => space.memoryDir))
  mcpServer = createLunaMcpServer({
    homeDir,
    toolModules: [createMemoryToolModule(memory)],
    requestRenderer,
    agentSession: agentSessionManager,
    directorPlanTools: createDirectorPlanAgentService(async () => getDirectorPlanDir(await getSettings())),
    activateWindow: () => activateAgentWindow(context),
    musicTools: {
      listMusicTemplates,
      getMusicTemplate,
      generateBackgroundMusic,
    },
  })
  void mcpServer.start().catch((error: unknown) => {
    console.error('[MCP] 本机服务启动失败', error)
  })

  let memoryDrained = false
  let memoryDraining = false
  app.on('before-quit', event => {
    if (memoryDrained) return
    event.preventDefault()
    if (memoryDraining) return
    memoryDraining = true
    void memory.close().finally(() => {
      // Let settled tool handlers archive their result before history's next drain.
      setImmediate(() => { memoryDrained = true; app.quit() })
    })
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

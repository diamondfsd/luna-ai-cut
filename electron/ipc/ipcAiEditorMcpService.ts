import { app, ipcMain } from 'electron'
import path from 'node:path'

import type { IpcContext } from './context'
import { createLunaMcpServer, type LunaMcpServer } from '../mcp/lunaMcpServer'
import { generateBackgroundMusic, getMusicTemplate, listMusicTemplates } from '../features/music/musicGenerationService.ts'
import { activateAgentWindow } from './ipcAiEditorAgentService'
import { agentSessionManager } from '../mcp/agentSessionManager'
import { createDirectorPlanAgentService } from '../features/director-lab/directorPlanAgentService'
import { getDirectorPlanDir, getSettings } from '../storage/fileService'
import { agentPersonalSpace } from '../features/agent-space/agentPersonalSpace.ts'
import { createMemoryRepository } from '../features/memory/memoryRepository.ts'
import { createMemoryService } from '../features/memory/memoryService.ts'
import { createMemoryToolModule } from '../features/memory/memoryToolModule.ts'

let registered = false
let mcpServer: LunaMcpServer | null = null

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

  const homeDir = process.env.LUNA_E2E_USER_DATA_DIR ?? app.getPath('home')
  const space = agentPersonalSpace(homeDir)
  const memory = createMemoryService(createMemoryRepository(async () => space.memoryDir))
  mcpServer = createLunaMcpServer({
    homeDir,
    toolModules: [createMemoryToolModule(memory)],
    aiEditorBaseDir: async () => (await getSettings()).baseDir,
    agentSession: agentSessionManager,
    directorPlanTools: createDirectorPlanAgentService(async () => getDirectorPlanDir(await getSettings())),
    activateWindow: () => activateAgentWindow(context),
    musicTools: { listMusicTemplates, getMusicTemplate, generateBackgroundMusic },
  })
  void mcpServer.start().catch((error: unknown) => console.error('[MCP] 本机服务启动失败', error))

  let memoryDrained = false
  let memoryDraining = false
  app.on('before-quit', event => {
    if (memoryDrained) return
    event.preventDefault()
    if (memoryDraining) return
    memoryDraining = true
    void memory.close().finally(() => {
      setImmediate(() => { memoryDrained = true; app.quit() })
    })
  })
  app.once('will-quit', () => { void mcpServer?.stop() })
}

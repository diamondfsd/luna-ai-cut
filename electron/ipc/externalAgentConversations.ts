import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import { join } from 'node:path'
import { createAgentConversationStore } from '../features/external-agents/agentConversationStore'
import { createAgentTaskCoordinator } from '../features/external-agents/agentTaskCoordinator'
import { agentSessionManager } from '../mcp/agentSessionManager'
import { getAgentHttpConnection } from './ipcAiEditorMcpService'
import { getSettings } from '../storage/fileService'
import type { createExternalAgentService } from '../features/external-agents/externalAgentService'
import type { AgentTaskInput } from '../../src/shared/types/agentConversation'
import { agentPersonalSpace } from '../features/agent-space/agentPersonalSpace.ts'

export function registerAgentConversations(adapters: ReturnType<typeof createExternalAgentService>): void {
  const space = agentPersonalSpace(process.env.LUNA_E2E_USER_DATA_DIR ?? app.getPath('home'))
  const store = createAgentConversationStore(async () => space.conversationsDir,
    async () => process.env.LUNA_E2E_USER_DATA_DIR ? null : join((await getSettings()).baseDir, 'agent-conversations'))
  let drained = false
  let archiveVersion = 0
  agentSessionManager.archive.load = async id => {
    const item = (await store.list()).find(item => item.id === id)
    return item ? { session: item.session, sequence: Math.max(0, ...item.events.map(event => event.sequence)) } : null
  }
  const notify = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('external-agent:history-changed')
    }
  }
  agentSessionManager.subscribe(event => {
    drained = false
    archiveVersion++
    void store.capture(event).then(notify).catch(error => console.error('[AI 助手] 保存任务历史失败', error))
  })
  const launch = createAgentTaskCoordinator({ manager: agentSessionManager, store, adapters,
    connection: getAgentHttpConnection, copy: text => clipboard.writeText(text) })
  ipcMain.handle('external-agent:start-task', async (_event, id: string, input: AgentTaskInput) => {
    try { return await launch(id, input) } finally { notify() }
  })
  ipcMain.handle('external-agent:copy-task', async (_event, id: string, input: AgentTaskInput) => {
    try { return await launch(id, input, true) } finally { notify() }
  })
  ipcMain.handle('external-agent:history', () => store.list())
  ipcMain.handle('external-agent:delete-history', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('任务记录无效')
    const session = agentSessionManager.snapshot().session
    if (session?.sessionId === id && ['queued', 'running'].includes(session.status)) throw new Error('请先停止任务')
    await store.remove(id)
    notify()
  })
  app.on('before-quit', event => {
    if (drained) return
    event.preventDefault()
    const version = archiveVersion
    void store.flush().finally(() => { drained = version === archiveVersion; app.quit() })
  })
}

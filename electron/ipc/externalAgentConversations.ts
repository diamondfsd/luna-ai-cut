import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import { join } from 'node:path'
import { createAgentConversationStore } from '../features/external-agents/agentConversationStore'
import { createAgentTaskCoordinator } from '../features/external-agents/agentTaskCoordinator'
import { agentSessionManager } from '../mcp/agentSessionManager'
import { getAgentHttpConnection } from './ipcAiEditorMcpService'
import { getSettings } from '../storage/fileService'
import type { createExternalAgentService } from '../features/external-agents/externalAgentService'
import type { AgentTaskInput } from '../../src/shared/types/agentConversation'

export function registerAgentConversations(adapters: ReturnType<typeof createExternalAgentService>): void {
  const store = createAgentConversationStore(async () => join((await getSettings()).baseDir, 'agent-conversations'))
  const notify = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('external-agent:history-changed')
    }
  }
  agentSessionManager.subscribe(event => {
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
  let drained = false
  app.on('before-quit', event => {
    if (drained) return
    event.preventDefault()
    void store.flush().finally(() => { drained = true; app.quit() })
  })
}

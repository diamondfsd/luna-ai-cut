import { registerAgentConversations } from './externalAgentConversations'
import { clipboard, ipcMain, shell } from 'electron'
import { createExternalAgentService } from '../features/external-agents/externalAgentService'
import { codexAdapter } from '../features/external-agents/codexAdapter'
import { workBuddyAdapter } from '../features/external-agents/workBuddyAdapter'

export function register(context: import('./context').IpcContext): void {
  ipcMain.handle('external-agent:open-chat', (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('任务无效')
    const value = input as import('../../src/shared/types/agentChat').AgentChatContext
    if (!['editing', 'director-plan'].includes(value.purpose)
      || (value.request !== undefined && (typeof value.request !== 'string' || value.request.length > 100_000))
      || (value.projectId != null && typeof value.projectId !== 'string')) throw new Error('任务无效')
    const window = context.win
    if (!window || window.isDestroyed()) throw new Error('Luna 窗口不可用')
    window.webContents.send('external-agent:chat-open', {
      purpose: value.purpose, request: value.request, projectId: value.projectId ?? null,
    })
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  const service = createExternalAgentService([workBuddyAdapter, codexAdapter], {
    openExternal: url => shell.openExternal(url),
    copyText: text => clipboard.writeText(text),
  })
  ipcMain.handle('external-agent:list', () => service.list())
  ipcMain.handle('external-agent:installed', (_event, id: string) => service.isInstalled(id))
  ipcMain.handle('external-agent:open', (_event, id: string) => service.open(id))
  ipcMain.handle('external-agent:download', (_event, id: string) => service.download(id))
  ipcMain.handle('external-agent:install-skill', (_event, id: string) => service.installSkill(id))
  registerAgentConversations(service)
}

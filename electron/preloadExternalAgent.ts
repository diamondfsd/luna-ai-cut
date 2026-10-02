import { ipcRenderer } from 'electron'
import type { ExternalAgentApi } from '../src/shared/types/externalAgent'

export const externalAgentApi: ExternalAgentApi = {
  openChat: context => ipcRenderer.invoke('external-agent:open-chat', context),
  onOpenChat: callback => {
    const listener = (_event: Electron.IpcRendererEvent, context: import('../src/shared/types/agentChat').AgentChatContext) => callback(context)
    ipcRenderer.on('external-agent:chat-open', listener)
    return () => ipcRenderer.off('external-agent:chat-open', listener)
  },
  list: () => ipcRenderer.invoke('external-agent:list'),
  isInstalled: id => ipcRenderer.invoke('external-agent:installed', id),
  open: id => ipcRenderer.invoke('external-agent:open', id),
  download: id => ipcRenderer.invoke('external-agent:download', id),
  installSkill: id => ipcRenderer.invoke('external-agent:install-skill', id),
  startTask: (id, request) => ipcRenderer.invoke('external-agent:start-task', id, request),
}

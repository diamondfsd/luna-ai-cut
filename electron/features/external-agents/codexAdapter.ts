import { buildCodexTaskUrl } from './taskLinks'
import { app, shell } from 'electron'
import type { ExternalAgentAdapter } from './adapter'
import { createProtocolLauncher } from './protocolLauncher'

const protocol = createProtocolLauncher('codex://', {
  getApplicationNameForProtocol: url => app.getApplicationNameForProtocol(url),
  openExternal: url => shell.openExternal(url),
})

export const codexAdapter: ExternalAgentAdapter = {
  descriptor: {
    id: 'codex',
    name: 'Codex',
    capabilities: { open: true, download: false, skillInstallation: false, task: 'draft' },
  },
  startTask: async ({ prompt }) => {
    await shell.openExternal(buildCodexTaskUrl(prompt))
    return { mode: 'draft' }
  },
  isInstalled: async () => protocol.isRegistered(),
  open: async () => {
    if (!await protocol.open()) throw new Error('未检测到 Codex')
  },
}

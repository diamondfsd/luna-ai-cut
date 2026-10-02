import { buildWorkBuddyTaskUrl } from './taskLinks'
import { app, clipboard, shell } from 'electron'
import { createProtocolLauncher } from './protocolLauncher'
import type { ExternalAgentAdapter } from './adapter'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const protocol = createProtocolLauncher('workbuddy://', {
  getApplicationNameForProtocol: url => app.getApplicationNameForProtocol(url),
  openExternal: url => shell.openExternal(url),
})
const run = promisify(execFile)
const downloadUrl = 'https://www.workbuddy.cn/events/invite/?inviteCode=pvprz2q5i'

async function findWorkBuddy(): Promise<string | null> {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/WorkBuddy.app', join(homedir(), 'Applications/WorkBuddy.app')]
    : process.platform === 'win32'
      ? [
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs/WorkBuddy/WorkBuddy.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'WorkBuddy/WorkBuddy.exe'),
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'WorkBuddy/WorkBuddy.exe'),
      ]
      : []
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch { /* Continue checking installation locations. */ }
  }
  return null
}

export const workBuddyAdapter: ExternalAgentAdapter = {
  descriptor: {
    id: 'workbuddy',
    name: 'WorkBuddy',
    capabilities: { open: true, download: true, skillInstallation: false, task: 'draft' },
  },
  downloadUrl,
  startTask: async ({ prompt }) => {
    if (!protocol.isRegistered()) {
      await workBuddyAdapter.open?.()
      clipboard.writeText(prompt)
      return { mode: 'clipboard' }
    }
    await shell.openExternal(buildWorkBuddyTaskUrl(prompt))
    return { mode: 'draft' }
  },
  isInstalled: async () => protocol.isRegistered() || Boolean(await findWorkBuddy()),
  open: async () => {
    if (await protocol.open()) return
    const application = await findWorkBuddy()
    if (!application) throw new Error('请先下载 WorkBuddy')
    if (process.platform === 'darwin') await run('/usr/bin/open', [application])
    else {
      const error = await shell.openPath(application)
      if (error) throw new Error('无法打开 WorkBuddy')
    }
  },
}

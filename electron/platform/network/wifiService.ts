import { shell } from 'electron'
import { spawn } from 'node:child_process'

export async function openWifiSettings(): Promise<void> {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:network-wifi')
    return
  }

  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.network')
    return
  }

  const child = spawn('nm-connection-editor', {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function lunaKaDeviceName(): Promise<string> {
  let name = hostname().trim()
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
        timeout: 2000,
        maxBuffer: 4096,
        encoding: 'utf8',
      })
      name = stdout.trim() || name
    } catch {
      name = name.replace(/\.local$/i, '')
    }
  }
  return (name || 'PC').slice(0, 80)
}

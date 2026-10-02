import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { AdbDevice, AdbForward, RunAdb } from './androidAdbClient.ts'

export function bundledHdcBinary(): string | null {
  const name = process.platform === 'win32' ? 'hdc.exe' : 'hdc'
  const candidates = [process.env.LUNA_HDC_BIN,
    process.resourcesPath ? join(process.resourcesPath, 'harmony-hdc', name) : null,
    join(process.cwd(), 'resources/harmony-hdc', `${process.platform}-${process.arch}`, name)]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null
}

export function createHdcRunner(binary: string): RunAdb {
  return (args, signal) => new Promise((resolve, reject) => {
    execFile(binary, args, { cwd: dirname(binary), windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024, signal },
      (error, stdout, stderr) => {
        const output = stdout.trim()
        // hdc may print a task failure while returning exit code zero.
        if (error || /(?:\[Fail\]|\[Error\])/i.test(`${output}\n${stderr}`)) {
          reject(new Error(stderr.trim() || output || error?.message || '手机连接失败'))
        } else resolve(output)
      })
  })
}

export function parseHdcTargets(output: string): AdbDevice[] {
  const devices = new Map<string, AdbDevice>()
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    // Verbose output: connectKey USB Connected ...; exclude TCP/UART targets.
    if (parts.length < 3 || parts[1].toUpperCase() !== 'USB') continue
    const state = parts[2].toLowerCase()
    devices.set(parts[0], { serial: parts[0], state: state === 'connected' ? 'device'
      : /unauthor|auth/.test(state) ? 'unauthorized' : 'offline' })
  }
  return [...devices.values()]
}

async function allocatePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('手机连接端口无效')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

export async function createHdcForward(run: RunAdb, serial: string): Promise<AdbForward> {
  // hdc does not provide adb's tcp:0 allocation. Retry the bind race with a new port.
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await allocatePort()
    try {
      await run(['-t', serial, 'fport', `tcp:${port}`, 'tcp:4184'])
      return { serial, port }
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  throw new Error('无法建立手机连接')
}

export async function removeHdcForward(run: RunAdb, forward: AdbForward): Promise<void> {
  const output = await run(['fport', 'ls'])
  const owned = output.split(/\r?\n/).some(line => {
    const fields = line.trim().split(/\s+/)
    return fields[0] === forward.serial && fields[1] === `tcp:${forward.port}` && fields[2] === 'tcp:4184'
      && (!fields[3] || fields[3] === '[Forward]')
  })
  if (owned) await run(['-t', forward.serial, 'fport', 'rm', `tcp:${forward.port}`, 'tcp:4184'])
}

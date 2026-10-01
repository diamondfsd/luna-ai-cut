import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface AdbDevice {
  serial: string
  state: string
}

export function parseAdbDevices(output: string): AdbDevice[] {
  const devices = new Map<string, AdbDevice>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(device|unauthorized|offline)(?:\s|$)/)
    if (!match || /^(?:emulator-)|:|\._adb-tls-/.test(match[1])) continue
    devices.set(match[1], { serial: match[1], state: match[2] })
  }
  return [...devices.values()]
}

export function bundledAdbBinary(): string | null {
  const candidates = [
    process.env.LUNA_ADB_BIN,
    process.resourcesPath ? join(process.resourcesPath, 'android-adb', 'adb.exe') : null,
    join(process.cwd(), 'resources/android-adb/win-x64/adb.exe'),
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null
}

export type RunAdb = (args: string[], signal?: AbortSignal) => Promise<string>

export function createAdbRunner(binary: string): RunAdb {
  return (args, signal) => new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024, signal },
      (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout.trim()))
  })
}

export interface AdbForward {
  serial: string
  port: number
}

export async function createAdbForward(run: RunAdb, serial: string): Promise<AdbForward> {
  const output = await run(['-s', serial, 'forward', 'tcp:0', 'tcp:4184'])
  const port = Number(output)
  if (!/^\d+$/.test(output) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('手机连接端口无效')
  }
  return { serial, port }
}

export async function removeAdbForward(run: RunAdb, forward: AdbForward): Promise<void> {
  const mappings = await run(['forward', '--list'])
  const owned = mappings.split(/\r?\n/).some((line) => {
    const [serial, local, remote] = line.trim().split(/\s+/)
    return serial === forward.serial && local === `tcp:${forward.port}` && remote === 'tcp:4184'
  })
  if (owned) await run(['-s', forward.serial, 'forward', '--remove', `tcp:${forward.port}`])
}

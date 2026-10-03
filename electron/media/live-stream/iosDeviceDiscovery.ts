import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type IosDeviceDiscoveryResult = {
  state: 'detected' | 'none' | 'unavailable'
  deviceCount: number
}

const SCAN_INTERVAL_MS = 2_000
const SCAN_TIMEOUT_MS = 3_000

export function parseIdeviceIdOutput(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}

function ideviceIdBinary(): string | null {
  const configured = process.env.USB_VIDEO_IDEVICE_ID_BIN
  const resourcesPath = process.resourcesPath
  const bundled = process.platform === 'win32' && resourcesPath
    ? join(resourcesPath, 'ios-usb', 'idevice_id.exe')
    : null
  const command = process.platform === 'win32' ? 'idevice_id.exe' : 'idevice_id'
  const candidates = [
    configured,
    bundled,
    ...(process.platform === 'win32' ? [join(process.cwd(), 'resources', 'ios-usb', 'win-x64', 'idevice_id.exe')] : []),
    '/opt/homebrew/bin/idevice_id',
    '/usr/local/bin/idevice_id',
    '/usr/bin/idevice_id',
    command,
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => candidate === command || existsSync(candidate)) ?? null
}

export class IosDeviceDiscovery {
  private running = false
  private generation = 0
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | null = null
  private onResult: ((result: IosDeviceDiscoveryResult) => void) | null = null
  private lastResult: IosDeviceDiscoveryResult | null = null

  start(onResult: (result: IosDeviceDiscoveryResult) => void): void {
    if (this.running) return
    this.running = true
    this.generation += 1
    this.onResult = onResult
    this.scan()
  }

  stop(): void {
    this.running = false
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill('SIGTERM')
    this.onResult = null
    this.lastResult = null
  }

  private scan(): void {
    if (!this.running || this.child || this.timer) return
    const binary = ideviceIdBinary()
    if (!binary) {
      this.publish({ state: 'unavailable', deviceCount: 0 })
      this.scheduleNext()
      return
    }

    let child: ChildProcess
    try {
      child = spawn(binary, ['-l'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      this.publish({ state: 'unavailable', deviceCount: 0 })
      this.scheduleNext()
      return
    }

    this.child = child
    const generation = this.generation
    let output = ''
    let finished = false
    const finish = (result: IosDeviceDiscoveryResult) => {
      if (finished) return
      finished = true
      if (generation !== this.generation) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      if (this.child === child) this.child = null
      if (!this.running) return
      this.publish(result)
      this.scheduleNext()
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (output.length < 16_384) output += String(chunk)
    })
    child.once('error', () => finish({ state: 'unavailable', deviceCount: 0 }))
    child.once('close', (code) => {
      if (code !== 0) {
        finish({ state: 'unavailable', deviceCount: 0 })
        return
      }
      const deviceCount = parseIdeviceIdOutput(output).length
      finish({ state: deviceCount > 0 ? 'detected' : 'none', deviceCount })
    })
    this.timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ state: 'unavailable', deviceCount: 0 })
    }, SCAN_TIMEOUT_MS)
  }

  private scheduleNext(): void {
    if (!this.running || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.scan()
    }, SCAN_INTERVAL_MS)
  }

  private publish(result: IosDeviceDiscoveryResult): void {
    if (this.lastResult?.state === result.state && this.lastResult.deviceCount === result.deviceCount) return
    this.lastResult = result
    this.onResult?.(result)
  }
}

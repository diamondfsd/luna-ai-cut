import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'

import { decodeDjiMessage, type DjiMessage } from './djiBytes'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import { getSwiftScriptPath } from '../swiftUtils'
import type { DjiBleTransport } from './djiBleSession'

export interface NativeDjiBluetoothBridgeConfig {
  platform: NodeJS.Platform
  executable: string
  scriptPath: string
  args?: string[]
}

interface BridgeReply {
  id?: string
  ok?: boolean
  event?: string
  code?: string
  message?: string
  name?: string
  characteristic?: string
  payloadHex?: string
}

interface PendingRequest {
  resolve: (reply: BridgeReply) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface MessageWaiter {
  predicate: (message: DjiMessage) => boolean
  resolve: (message: DjiMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const REQUEST_TIMEOUT_MS = 12000
const CONNECT_TIMEOUT_MS = 30000
const PAIRING_CONFIRMATION_TIMEOUT_MS = 15000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asError(message: string): Error {
  return new Error(`DJI Bluetooth：${message}`)
}

/**
 * Line-protocol native bridge for the small BLE portion of the DJI protocol.
 * The media session remains on Wi-Fi; this process is deliberately short-lived
 * and only exists while the camera is being activated and queried.
 */
export class NativeDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer

  private readonly bridgeConfig: NativeDjiBluetoothBridgeConfig
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private requestCounter = 0
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly queuedMessages: DjiMessage[] = []
  private readonly messageWaiters: MessageWaiter[] = []
  private closed = false
  private connected = false

  constructor(deviceId: string, bridgeConfig: NativeDjiBluetoothBridgeConfig) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
    this.bridgeConfig = bridgeConfig
  }

  async armPairing(): Promise<void> {
    await this.ensureConnected()
    await this.request('arm')
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw asError('要发送的 DUML 帧无效')

    await this.ensureConnected()
    await this.request('write', { payloadHex: frame.toString('hex') })
    const response = await this.waitForMessage(
      (message) => message.cmdSet === decoded.message.cmdSet && message.cmdId === decoded.message.cmdId,
      REQUEST_TIMEOUT_MS,
    )
    return [response]
  }

  async waitForPairingConfirmation(): Promise<DjiMessage | null> {
    return this.waitForMessage(
      (message) => message.cmdSet === 0x07 && message.cmdId === 0x46 && message.flags === 0x40,
      PAIRING_CONFIRMATION_TIMEOUT_MS,
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      if (this.child && !this.child.killed) {
        await this.request('close', {}, 3000).catch(() => undefined)
      }
    } finally {
      this.rejectPending(asError('BLE 会话已关闭'))
      if (this.child && !this.child.killed) this.child.kill('SIGTERM')
      this.child = null
      this.connected = false
    }
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (process.platform !== this.bridgeConfig.platform) throw asError(`当前平台不支持 DJI Bluetooth：${process.platform}`)
    if (this.child && !this.child.killed) return this.child
    const scriptPath = this.bridgeConfig.scriptPath
    if (!existsSync(scriptPath)) throw asError('未找到 CoreBluetooth DJI 适配器')

    const child = spawn(this.bridgeConfig.executable, [...(this.bridgeConfig.args ?? []), scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout.on('data', (data: Buffer) => this.consumeStdout(data.toString('utf8')))
    child.stderr.on('data', (data: Buffer) => {
      this.stderrBuffer = `${this.stderrBuffer}${data.toString('utf8')}`.slice(-4000)
    })
    child.on('error', (error) => this.handleProcessError(asError(error.message)))
    child.on('close', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      if (!this.closed) {
        const detail = this.stderrBuffer.trim()
        this.handleProcessError(asError(detail || `CoreBluetooth helper 已退出（${code ?? signal ?? '未知原因'}）`))
      }
    })
    return child
  }

  private async connect(): Promise<void> {
    if (this.connected) return
    const profile = this.profile.ble
    const reply = await this.request('connect', {
      serviceUuid: profile.serviceUuid,
      writeCharacteristicUuid: profile.writeCharacteristicUuid,
      notifyCharacteristicUuid: profile.notifyCharacteristicUuid,
      namePrefixes: profile.namePrefixes,
      excludedNamePrefixes: profile.excludedNamePrefixes,
    }, CONNECT_TIMEOUT_MS)
    if (reply.event !== 'ready') throw asError(reply.message ?? 'BLE 设备没有准备完成')
    this.connected = true
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
  }

  private async request(command: string, body: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<BridgeReply> {
    const child = this.ensureProcess()
    const id = `${Date.now()}-${this.requestCounter += 1}`
    const request = JSON.stringify({ id, command, ...body })
    return new Promise<BridgeReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(asError(`${command} 操作超时`))
      }, timeoutMs)
      this.pendingRequests.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(`${request}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(asError(errorText(error)))
      }
    }).then((reply) => {
      if (reply.ok === false) throw asError(reply.message ?? reply.code ?? `${command} 操作失败`)
      return reply
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) {
        try {
          this.handleBridgeMessage(JSON.parse(line) as BridgeReply)
        } catch {
          this.handleProcessError(asError('CoreBluetooth helper 返回了无效数据'))
        }
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleBridgeMessage(message: BridgeReply): void {
    if (message.id) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        this.pendingRequests.delete(message.id)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
    }
    if (message.event === 'notification' && message.payloadHex) {
      this.consumeNotification(Buffer.from(message.payloadHex, 'hex'))
    } else if (message.event === 'notification-error' || message.event === 'error' || message.event === 'disconnected') {
      this.handleProcessError(asError(message.message ?? 'BLE 设备已断开'))
    }
  }

  private consumeNotification(chunk: Buffer): void {
    let data = Buffer.concat([this.notificationBuffer, chunk])
    while (data.length > 0) {
      const start = data.indexOf(0x55)
      if (start < 0) {
        data = Buffer.alloc(0)
        break
      }
      if (start > 0) data = data.subarray(start)
      if (data.length < 4) {
        this.notificationBuffer = data
        return
      }
      const length = data[1] | ((data[2] & 0x03) << 8)
      if (length < 13 || length > 0x3ff) {
        data = data.subarray(1)
        continue
      }
      if (data.length < length) {
        this.notificationBuffer = data
        return
      }
      const decoded = decodeDjiMessage(data)
      if (!decoded) {
        data = data.subarray(1)
        continue
      }
      this.notificationBuffer = Buffer.alloc(0)
      this.enqueueMessage(decoded.message)
      data = data.subarray(decoded.next)
    }
    this.notificationBuffer = data
  }

  private notificationBuffer = Buffer.alloc(0)

  private enqueueMessage(message: DjiMessage): void {
    const waiterIndex = this.messageWaiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const waiter = this.messageWaiters.splice(waiterIndex, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.queuedMessages.push(message)
  }

  private waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    const queuedIndex = this.queuedMessages.findIndex(predicate)
    if (queuedIndex >= 0) return Promise.resolve(this.queuedMessages.splice(queuedIndex, 1)[0])
    if (this.closed) return Promise.reject(asError('BLE 会话已关闭'))
    return new Promise<DjiMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.messageWaiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.messageWaiters.splice(index, 1)
        reject(asError('等待 DJI BLE 响应超时'))
      }, timeoutMs)
      this.messageWaiters.push({ predicate, resolve, reject, timer })
    })
  }

  private handleProcessError(error: Error): void {
    this.connected = false
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
    for (const waiter of this.messageWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.messageWaiters.length = 0
  }
}

export class CoreBluetoothDjiBleTransport extends NativeDjiBleTransport {
  constructor(deviceId: string) {
    super(deviceId, {
      platform: 'darwin',
      executable: 'swift',
      scriptPath: getSwiftScriptPath('djiCoreBluetoothTransport.swift'),
    })
  }
}

export function createCoreBluetoothDjiBleTransport(deviceId: string): CoreBluetoothDjiBleTransport | null {
  return process.platform === 'darwin' ? new CoreBluetoothDjiBleTransport(deviceId) : null
}

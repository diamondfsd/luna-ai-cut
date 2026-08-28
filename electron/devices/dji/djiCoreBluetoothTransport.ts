import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'

import { decodeDjiMessage, responseToDjiRequest, type DjiMessage } from './djiBytes'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import { djiErrorDetails, djiMessageDetails } from './djiLog'
import { getDjiCoreBluetoothHelperPath } from '../../platform/macos/swiftUtils'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { DjiBleTransport } from './djiBleSession'

export interface NativeDjiBluetoothBridgeConfig {
  platform: NodeJS.Platform
  executable: string
  scriptPath?: string
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
// GATT discovery normally completes within a couple of seconds. If CoreBluetooth
// gets stuck while enabling notifications, retrying a fresh helper is faster than
// holding the whole connection flow for the old 20-second request timeout.
const CONNECT_TIMEOUT_MS = 7000
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
    logMainDebug('[DJI BLE] 原生桥发送授权准备命令', { deviceId: this.profile.deviceId })
    await this.request('arm')
  }

  async send(frame: Buffer): Promise<void> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw asError('要发送的 DUML 帧无效')
    await this.ensureConnected()
    const quiet = decoded.message.cmdSet === 0x00 && decoded.message.cmdId === 0x2b
    if (!quiet) {
      logMainDebug('[DJI BLE] 原生桥发送 DUML', { deviceId: this.profile.deviceId, ...djiMessageDetails(decoded.message) })
    }
    await this.request('write', { payloadHex: frame.toString('hex') }, REQUEST_TIMEOUT_MS, !quiet)
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw asError('要发送的 DUML 帧无效')

    const response = await this.waitForMessage(
      (message) => message.cmdSet === decoded.message.cmdSet && message.cmdId === decoded.message.cmdId,
      REQUEST_TIMEOUT_MS,
    )
    await this.send(frame)
    return [response]
  }

  async waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    return this.waitForMessageInternal(predicate, timeoutMs)
  }

  async waitForPairingConfirmation(): Promise<DjiMessage | null> {
    return this.waitForMessage(
      (message) => message.cmdSet === 0x07 && message.cmdId === 0x46 && message.flags === 0x40,
      PAIRING_CONFIRMATION_TIMEOUT_MS,
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    logMainDebug('[DJI BLE] 关闭原生 BLE 桥', { deviceId: this.profile.deviceId })
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
    const launchPath = this.bridgeConfig.scriptPath ?? this.bridgeConfig.executable
    if (!existsSync(launchPath)) throw asError('未找到 CoreBluetooth DJI 适配器')

    const args = [
      ...(this.bridgeConfig.args ?? []),
      ...(this.bridgeConfig.scriptPath ? [this.bridgeConfig.scriptPath] : []),
    ]
    const child = spawn(this.bridgeConfig.executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    logMainInfo('[DJI BLE] 原生 BLE 桥进程已启动', {
      deviceId: this.profile.deviceId,
      executable: this.bridgeConfig.executable,
      script: this.bridgeConfig.scriptPath,
    })
    child.stdout.on('data', (data: Buffer) => this.consumeStdout(data.toString('utf8')))
    child.stderr.on('data', (data: Buffer) => {
      this.stderrBuffer = `${this.stderrBuffer}${data.toString('utf8')}`.slice(-4000)
    })
    child.on('error', (error) => this.handleProcessError(asError(error.message)))
    child.on('close', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      logMainWarn('[DJI BLE] 原生 BLE 桥进程已退出', {
        deviceId: this.profile.deviceId,
        code,
        signal,
        stderr: this.stderrBuffer.trim() || undefined,
      })
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
    const startedAt = Date.now()
    logMainInfo('[DJI BLE] 开始连接原生 BLE 桥', {
      deviceId: this.profile.deviceId,
      modelNumber: this.profile.modelNumber,
      namePrefixes: profile.namePrefixes,
      excludedNamePrefixes: profile.excludedNamePrefixes,
      serviceUuid: profile.serviceUuid,
      timeoutMs: CONNECT_TIMEOUT_MS,
    })
    try {
      const reply = await this.request('connect', {
        serviceUuid: profile.serviceUuid,
        writeCharacteristicUuid: profile.writeCharacteristicUuid,
        notifyCharacteristicUuid: profile.notifyCharacteristicUuid,
        modelNumber: this.profile.modelNumber,
        namePrefixes: profile.namePrefixes,
        excludedNamePrefixes: profile.excludedNamePrefixes,
      }, CONNECT_TIMEOUT_MS)
      if (reply.event !== 'ready') throw asError(reply.message ?? 'BLE 设备没有准备完成')
      this.connected = true
      logMainInfo('[DJI BLE] 原生 BLE 连接准备完成', {
        deviceId: this.profile.deviceId,
        event: reply.event,
        name: reply.name,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      // A CoreBluetooth helper that timed out can retain a stale peripheral
      // connection. Always discard it so the next attempt starts a fresh BLE
      // session instead of reusing the controller's failed state.
      this.resetHelper()
      logMainError('[DJI BLE] 原生 BLE 连接失败', {
        deviceId: this.profile.deviceId,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
  }

  private async request(command: string, body: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS, logLifecycle = true): Promise<BridgeReply> {
    const child = this.ensureProcess()
    const id = `${Date.now()}-${this.requestCounter += 1}`
    const request = JSON.stringify({ id, command, ...body })
    const startedAt = Date.now()
    if (logLifecycle) {
      logMainDebug('[DJI BLE] 原生桥请求开始', {
        deviceId: this.profile.deviceId,
        command,
        requestId: id,
        timeoutMs,
      })
    }
    return new Promise<BridgeReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        if (logLifecycle) {
          logMainWarn('[DJI BLE] 原生桥请求超时', {
            deviceId: this.profile.deviceId,
            command,
            requestId: id,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
          })
        }
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
      if (reply.ok === false) {
        if (logLifecycle) {
          logMainWarn('[DJI BLE] 原生桥请求返回失败', {
            deviceId: this.profile.deviceId,
            command,
            requestId: id,
            code: reply.code,
            message: reply.message,
            elapsedMs: Date.now() - startedAt,
          })
        }
        throw asError(reply.message ?? reply.code ?? `${command} 操作失败`)
      }
      if (logLifecycle) {
        logMainDebug('[DJI BLE] 原生桥请求完成', {
          deviceId: this.profile.deviceId,
          command,
          requestId: id,
          event: reply.event,
          elapsedMs: Date.now() - startedAt,
        })
      }
      return reply
    }).catch((error) => {
      if (logLifecycle && !(error instanceof Error && error.message.includes('操作超时'))) {
        logMainWarn('[DJI BLE] 原生桥请求异常', {
          deviceId: this.profile.deviceId,
          command,
          requestId: id,
          elapsedMs: Date.now() - startedAt,
          ...djiErrorDetails(error),
        })
      }
      throw error
    })
  }

  private resetHelper(): void {
    const child = this.child
    this.child = null
    this.connected = false
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    logMainWarn('[DJI BLE] 重置原生 BLE 桥进程', { deviceId: this.profile.deviceId })
    if (child && !child.killed) child.kill('SIGKILL')
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
          logMainError('[DJI BLE] 原生桥返回无效消息', { deviceId: this.profile.deviceId })
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
    } else if (message.event && message.event !== 'ready') {
      // Native helper lifecycle events are useful when diagnosing permission,
      // scan, GATT discovery, and camera approval failures.
      logMainInfo('[DJI BLE] CoreBluetooth 阶段', {
        event: message.event,
        message: message.message,
        name: message.name,
      })
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
    if (message.flags === 0x40) {
      void this.send(responseToDjiRequest(message)).catch((error: unknown) => {
        this.handleProcessError(asError(errorText(error)))
      })
    }
    const waiterIndex = this.messageWaiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const waiter = this.messageWaiters.splice(waiterIndex, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.queuedMessages.push(message)
  }

  private waitForMessageInternal(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    const queuedIndex = this.queuedMessages.findIndex(predicate)
    if (queuedIndex >= 0) return Promise.resolve(this.queuedMessages.splice(queuedIndex, 1)[0])
    if (this.closed) return Promise.reject(asError('BLE 会话已关闭'))
    return new Promise<DjiMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.messageWaiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.messageWaiters.splice(index, 1)
        const error = asError('等待 DJI BLE 响应超时')
        logMainWarn('[DJI BLE] 等待通知响应超时', {
          deviceId: this.profile.deviceId,
          timeoutMs,
          queuedMessages: this.queuedMessages.length,
        })
        reject(error)
      }, timeoutMs)
      this.messageWaiters.push({ predicate, resolve, reject, timer })
    })
  }

  private handleProcessError(error: Error): void {
    this.connected = false
    logMainError('[DJI BLE] 原生桥发生错误', { deviceId: this.profile.deviceId, ...djiErrorDetails(error) })
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
      executable: getDjiCoreBluetoothHelperPath(),
    })
  }
}

export function createCoreBluetoothDjiBleTransport(deviceId: string): CoreBluetoothDjiBleTransport | null {
  return process.platform === 'darwin' ? new CoreBluetoothDjiBleTransport(deviceId) : null
}

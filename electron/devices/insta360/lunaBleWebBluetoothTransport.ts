import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'

import type { LunaBluetoothRendererEvent } from '../../../src/shared/types'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { LUNA_BLE_WRITE_MAX_LENGTH } from './lunaBleCodec'
import {
  buildLunaWebBluetoothAvailabilityScript,
  buildLunaWebBluetoothCleanupScript,
  buildLunaWebBluetoothConnectScript,
  buildLunaWebBluetoothWriteScript,
  lunaBluetoothNamePrefixes,
} from './lunaBleWebBluetoothScripts'

const EVENT_CHANNEL = 'luna-web-bluetooth:event'
const CONNECT_TIMEOUT_MS = 30_000
const CONNECT_ATTEMPTS = 2
const CONNECT_RETRY_DELAY_MS = 300
const AVAILABILITY_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 12_000
const CLEANUP_TIMEOUT_MS = 3_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as { name?: unknown; message?: unknown; code?: unknown }
    const name = typeof value.name === 'string' ? value.name : ''
    const message = typeof value.message === 'string' ? value.message : ''
    const code = typeof value.code === 'string' || typeof value.code === 'number' ? String(value.code) : ''
    const detail = [name, message].filter(Boolean).join(': ')
    if (detail || code) return [detail, code ? `code=${code}` : ''].filter(Boolean).join(' ')
    try {
      return JSON.stringify(error)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return String(error)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface LunaBleTransport {
  onNotification: ((data: Buffer) => void) | null
  onError?: ((error: Error) => void) | null
  checkAvailability?(): Promise<boolean | null>
  connect(): Promise<void>
  send(frame: Buffer, label: string): Promise<void>
  close(): Promise<void>
}

interface BluetoothSelectionRequest {
  callback?: (deviceId: string) => void
  completed: boolean
  lastDeviceCount: number
  cancel: () => void
}

interface ConnectResult {
  deviceId: string
  deviceName: string
  source: 'granted' | 'request'
  serviceUuid: string
  writeCharacteristicUuid: string
  notifyCharacteristicUuid: string
}

const pendingSelections = new WeakMap<WebContents, BluetoothSelectionRequest>()
const installedWebContents = new WeakSet<WebContents>()
const activeTransports = new Map<string, WebBluetoothLunaBleTransport>()
let ipcRegistered = false

function validRendererEvent(value: unknown): value is LunaBluetoothRendererEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<LunaBluetoothRendererEvent>
  if (typeof event.token !== 'string' || event.token.length < 8) return false
  if (event.event !== 'notification' && event.event !== 'disconnected' && event.event !== 'stage') return false
  if (event.characteristic !== undefined && typeof event.characteristic !== 'string') return false
  if (event.payloadHex !== undefined && (typeof event.payloadHex !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(event.payloadHex))) return false
  if (event.message !== undefined && typeof event.message !== 'string') return false
  if (event.event === 'stage' && typeof event.message !== 'string') return false
  return true
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function matchesLunaBluetoothName(name: string | undefined): boolean {
  const candidate = String(name || '').trim().toLowerCase()
  if (!candidate) return false
  return lunaBluetoothNamePrefixes().some((prefix) => candidate.startsWith(prefix.toLowerCase()))
}

function beginSelection(contents: WebContents): () => void {
  const previous = pendingSelections.get(contents)
  previous?.cancel()

  const request: BluetoothSelectionRequest = {
    completed: false,
    lastDeviceCount: -1,
    cancel: () => {
      if (request.completed) return
      request.completed = true
      if (pendingSelections.get(contents) === request) pendingSelections.delete(contents)
      request.callback?.('')
      request.callback = undefined
    },
  }
  pendingSelections.set(contents, request)
  return request.cancel
}

/** Install Electron's device selection and pairing hooks for Luna Web Bluetooth. */
export function installLunaWebBluetoothHandlers(win: BrowserWindow): void {
  const contents = win.webContents
  if (installedWebContents.has(contents)) return
  installedWebContents.add(contents)

  contents.on('select-bluetooth-device', (event, devices, callback) => {
    const request = pendingSelections.get(contents)
    if (!request) return

    event.preventDefault()
    request.callback = callback
    const target = devices.find((device) => matchesLunaBluetoothName(device.deviceName))
    if (!target) {
      if (request.lastDeviceCount !== devices.length) {
        request.lastDeviceCount = devices.length
        logMainDebug('[Luna BLE] 扫描中，暂未找到目标设备', {
          candidateCount: devices.length,
          namePrefixes: lunaBluetoothNamePrefixes(),
        })
      }
      return
    }

    request.completed = true
    pendingSelections.delete(contents)
    request.callback = undefined
    logMainInfo('[Luna BLE] Electron 自动选择蓝牙设备', {
      deviceName: target.deviceName,
      candidateCount: devices.length,
    })
    callback(target.deviceId)
  })

  contents.on('destroyed', () => {
    pendingSelections.get(contents)?.cancel()
    pendingSelections.delete(contents)
  })

  if (process.platform === 'win32') {
    contents.session.setBluetoothPairingHandler((details, callback) => {
      logMainInfo('[Luna BLE] 收到蓝牙配对请求', {
        deviceId: details.deviceId,
        pairingKind: details.pairingKind,
        hasPin: Boolean(details.pin),
      })
      if (details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin') {
        callback({ confirmed: true })
        return
      }
      callback({ confirmed: false })
    })
  }
}

/** Register the renderer-to-main notification channel once during app startup. */
export function registerLunaWebBluetoothIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on(EVENT_CHANNEL, (event, value: unknown) => {
    if (!validRendererEvent(value)) {
      logMainWarn('[Luna BLE] 收到格式无效的 Web Bluetooth 事件')
      return
    }
    const transport = activeTransports.get(value.token)
    if (!transport || !transport.acceptsSender(event.sender)) {
      logMainWarn('[Luna BLE] 丢弃来源不匹配的 Web Bluetooth 事件', { event: value.event, token: value.token })
      return
    }
    transport.handleRendererEvent(value)
  })
}

export class WebBluetoothLunaBleTransport implements LunaBleTransport {
  private readonly window: BrowserWindow | null
  private readonly token = `luna-web-${randomUUID()}`
  private writeQueue: Promise<void> = Promise.resolve()
  private connected = false
  private closed = false
  private selectionCancel: (() => void) | null = null
  onNotification: ((data: Buffer) => void) | null = null
  onError: ((error: Error) => void) | null = null

  constructor(win: BrowserWindow | null) {
    this.window = win
    activeTransports.set(this.token, this)
    logMainInfo('[Luna BLE] 创建 Electron Web Bluetooth 传输', {
      token: this.token,
      hasWindow: Boolean(win && !win.isDestroyed()),
    })
  }

  acceptsSender(sender: WebContents): boolean {
    return sender === this.window?.webContents
  }

  async checkAvailability(): Promise<boolean | null> {
    try {
      const result = await withTimeout(
        this.execute(buildLunaWebBluetoothAvailabilityScript()),
        AVAILABILITY_TIMEOUT_MS,
        '检查蓝牙状态超时',
      )
      return typeof result === 'boolean' ? result : null
    } catch (error) {
      logMainWarn('[Luna BLE] 检查蓝牙适配器状态失败，将继续尝试连接', {
        error: errorMessage(error),
      })
      return null
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.closed) throw new Error('Luna 蓝牙会话已关闭')
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
    installLunaWebBluetoothHandlers(win)
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
      this.selectionCancel = beginSelection(win.webContents)
      try {
        const result = await withTimeout(
          this.execute(buildLunaWebBluetoothConnectScript(this.token), true) as Promise<ConnectResult>,
          CONNECT_TIMEOUT_MS,
          'Web Bluetooth 连接超时，请确认相机已开机且靠近电脑',
        )
        this.connected = true
        logMainInfo('[Luna BLE] Web Bluetooth 连接准备完成', {
          bluetoothDeviceId: result.deviceId,
          deviceName: result.deviceName,
          source: result.source,
          serviceUuid: result.serviceUuid,
          writeCharacteristicUuid: result.writeCharacteristicUuid,
          notifyCharacteristicUuid: result.notifyCharacteristicUuid,
          attempt,
        })
        return
      } catch (error) {
        lastError = new Error(errorMessage(error))
        await this.cleanupRendererState().catch(() => undefined)
        logMainWarn('[Luna BLE] Web Bluetooth 连接失败', {
          error: lastError.message,
          attempt,
          maxAttempts: CONNECT_ATTEMPTS,
        })
        if (attempt < CONNECT_ATTEMPTS) await delay(CONNECT_RETRY_DELAY_MS)
      } finally {
        this.selectionCancel?.()
        this.selectionCancel = null
      }
    }
    throw lastError ?? new Error('Web Bluetooth 连接失败')
  }

  async send(frame: Buffer, label: string): Promise<void> {
    if (frame.length === 0) throw new Error('Luna BLE 不允许发送空帧')
    await this.connect()
    const write = this.writeQueue.then(() => this.writeFrame(frame, label), () => this.writeFrame(frame, label))
    // Keep later frames ordered even if an earlier frame fails.
    this.writeQueue = write.then(() => undefined, () => undefined)
    await write
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.connected = false
    this.selectionCancel?.()
    this.selectionCancel = null
    activeTransports.delete(this.token)
    logMainDebug('[Luna BLE] 关闭 Electron Web Bluetooth 会话', { token: this.token })
    try {
      await withTimeout(this.execute(buildLunaWebBluetoothCleanupScript(this.token)), CLEANUP_TIMEOUT_MS, '关闭蓝牙会话超时')
    } catch (error) {
      logMainWarn('[Luna BLE] Web Bluetooth 会话清理失败', { error: errorMessage(error) })
    }
  }

  handleRendererEvent(event: LunaBluetoothRendererEvent): void {
    if (event.event === 'stage') {
      logMainInfo('[Luna BLE] Web Bluetooth 页面阶段', { stage: event.message })
      return
    }
    if (event.event === 'disconnected') {
      this.connected = false
      const error = new Error(event.message || '蓝牙设备已断开')
      logMainError('[Luna BLE] Web Bluetooth 设备已断开', { error: error.message })
      this.onError?.(error)
      return
    }
    if (!event.payloadHex) return
    const payload = Buffer.from(event.payloadHex, 'hex')
    logMainDebug('[Luna BLE] Web Bluetooth 收到通知', {
      characteristic: event.characteristic,
      payloadBytes: payload.length,
    })
    this.onNotification?.(payload)
  }

  private async writeFrame(frame: Buffer, label: string): Promise<void> {
    for (let offset = 0; offset < frame.length; offset += LUNA_BLE_WRITE_MAX_LENGTH) {
      const chunk = frame.subarray(offset, Math.min(offset + LUNA_BLE_WRITE_MAX_LENGTH, frame.length))
      await withTimeout(
        this.execute(buildLunaWebBluetoothWriteScript(this.token, [...chunk])),
        REQUEST_TIMEOUT_MS,
        `Luna 蓝牙写入超时（${label}）`,
      )
    }
    logMainDebug('[Luna BLE] Web Bluetooth 写入完成', {
      label,
      frameBytes: frame.length,
      chunks: Math.ceil(frame.length / LUNA_BLE_WRITE_MAX_LENGTH),
    })
  }

  private async execute(code: string, userGesture = false): Promise<unknown> {
    const contents = this.window?.webContents
    if (!contents || contents.isDestroyed()) throw new Error('主窗口不可用')
    return contents.executeJavaScript(code, userGesture)
  }

  private async cleanupRendererState(): Promise<void> {
    await withTimeout(this.execute(buildLunaWebBluetoothCleanupScript(this.token)), CLEANUP_TIMEOUT_MS, '清理蓝牙会话超时')
  }
}

export function createElectronLunaBleTransport(win: BrowserWindow | null): WebBluetoothLunaBleTransport | null {
  return (process.platform === 'darwin' || process.platform === 'win32') && win
    ? new WebBluetoothLunaBleTransport(win)
    : null
}

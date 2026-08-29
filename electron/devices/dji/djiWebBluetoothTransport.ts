import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'

import type { DjiBluetoothRendererEvent } from '../../../src/shared/types'
import { decodeDjiMessage, responseToDjiRequest, type DjiMessage } from './djiBytes'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import { buildDjiWebBluetoothAvailabilityScript, buildDjiWebBluetoothConnectScript, matchesDjiBluetoothName } from './djiWebBluetoothScripts'
import { djiErrorDetails, djiMessageDetails } from './djiLog'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import type { DjiBleTransport } from './djiBleSession'

const EVENT_CHANNEL = 'dji-web-bluetooth:event'
const CONNECT_TIMEOUT_MS = 30_000
const AVAILABILITY_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 12_000
const PAIRING_CONFIRMATION_TIMEOUT_MS = 15_000
const CLEANUP_TIMEOUT_MS = 3_000

interface BluetoothSelectionRequest {
  profile: DjiModelProfile
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
const activeTransports = new Map<string, WebBluetoothDjiBleTransport>()
let ipcRegistered = false

function validRendererEvent(value: unknown): value is DjiBluetoothRendererEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<DjiBluetoothRendererEvent>
  if (typeof event.token !== 'string' || event.token.length < 8) return false
  if (event.event !== 'notification' && event.event !== 'disconnected' && event.event !== 'stage') return false
  if (event.characteristic !== undefined && typeof event.characteristic !== 'string') return false
  if (event.payloadHex !== undefined && (typeof event.payloadHex !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(event.payloadHex))) return false
  if (event.message !== undefined && typeof event.message !== 'string') return false
  if (event.event === 'stage' && typeof event.message !== 'string') return false
  return true
}

function scriptValue(value: unknown): string {
  return JSON.stringify(value)
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

function beginSelection(contents: WebContents, profile: DjiModelProfile): () => void {
  const previous = pendingSelections.get(contents)
  previous?.cancel()

  const request: BluetoothSelectionRequest = {
    profile,
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

/** Install Electron's device selection and pairing hooks for the main window. */
export function installDjiWebBluetoothHandlers(win: BrowserWindow): void {
  const contents = win.webContents
  if (installedWebContents.has(contents)) return
  installedWebContents.add(contents)

  contents.on('select-bluetooth-device', (event, devices, callback) => {
    const request = pendingSelections.get(contents)
    if (!request) return

    event.preventDefault()
    request.callback = callback
    const target = devices.find((device) => matchesDjiBluetoothName(device.deviceName, request.profile))
    if (!target) {
      if (request.lastDeviceCount !== devices.length) {
        request.lastDeviceCount = devices.length
        logMainDebug('[DJI BLE] Web Bluetooth 扫描中，暂未找到目标设备', {
          deviceId: request.profile.deviceId,
          candidateCount: devices.length,
          namePrefixes: request.profile.ble.namePrefixes,
        })
      }
      return
    }

    request.completed = true
    pendingSelections.delete(contents)
    request.callback = undefined
    logMainInfo('[DJI BLE] Electron 自动选择蓝牙设备', {
      deviceId: request.profile.deviceId,
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
      logMainInfo('[DJI BLE] 收到蓝牙配对请求', {
        deviceId: details.deviceId,
        pairingKind: details.pairingKind,
        hasPin: Boolean(details.pin),
      })
      if (details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin') {
        callback({ confirmed: true })
        logMainInfo('[DJI BLE] 已确认蓝牙配对', {
          deviceId: details.deviceId,
          pairingKind: details.pairingKind,
        })
        return
      }

      logMainWarn('[DJI BLE] 蓝牙要求输入配对码，应用没有可用配对码', {
        deviceId: details.deviceId,
        pairingKind: details.pairingKind,
      })
      callback({ confirmed: false })
    })
  }
}

/** Register the renderer-to-main notification channel once during app startup. */
export function registerDjiWebBluetoothIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on(EVENT_CHANNEL, (event, value: unknown) => {
    if (!validRendererEvent(value)) {
      logMainWarn('[DJI BLE] 收到格式无效的 Web Bluetooth 事件')
      return
    }
    const transport = activeTransports.get(value.token)
    if (!transport || !transport.acceptsSender(event.sender)) {
      logMainWarn('[DJI BLE] 丢弃来源不匹配的 Web Bluetooth 事件', {
        event: value.event,
        token: value.token,
      })
      return
    }
    transport.handleRendererEvent(value)
  })
}

export class WebBluetoothDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer

  private readonly window: BrowserWindow | null
  private readonly token = `dji-web-${randomUUID()}`
  private readonly queuedMessages: DjiMessage[] = []
  private readonly messageWaiters: Array<MessageWaiter> = []
  private notificationBuffer = Buffer.alloc(0)
  private connected = false
  private closed = false
  private selectionCancel: (() => void) | null = null

  constructor(deviceId: string, win: BrowserWindow | null) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
    this.window = win
    activeTransports.set(this.token, this)
    logMainInfo('[DJI BLE] 创建 Electron Web Bluetooth 传输', {
      deviceId: this.profile.deviceId,
      token: this.token,
      hasWindow: Boolean(win && !win.isDestroyed()),
      serviceUuid: this.profile.ble.serviceUuid,
      writeCharacteristicUuid: this.profile.ble.writeCharacteristicUuid,
      notifyCharacteristicUuid: this.profile.ble.notifyCharacteristicUuid,
    })
  }

  acceptsSender(sender: WebContents): boolean {
    return sender === this.window?.webContents
  }

  async checkAvailability(): Promise<boolean | null> {
    const startedAt = Date.now()
    try {
      const result = await withTimeout(
        this.execute(buildDjiWebBluetoothAvailabilityScript()),
        AVAILABILITY_TIMEOUT_MS,
        '检查蓝牙状态超时',
      )
      const available = typeof result === 'boolean' ? result : null
      logMainInfo('[DJI BLE] 检查蓝牙适配器状态完成', {
        deviceId: this.profile.deviceId,
        available,
        elapsedMs: Date.now() - startedAt,
      })
      return available
    } catch (error) {
      logMainWarn('[DJI BLE] 检查蓝牙适配器状态失败，将继续尝试连接', {
        deviceId: this.profile.deviceId,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      return null
    }
  }

  async armPairing(): Promise<void> {
    await this.ensureConnected()
    logMainDebug('[DJI BLE] Web Bluetooth 发送授权准备命令', { deviceId: this.profile.deviceId })
    await this.executeOperation('arm', `
      const state = window.__lunaDjiBluetoothState;
      if (!state || state.token !== ${scriptValue(this.token)}) throw new Error('蓝牙会话不存在');
      const bytes = new Uint8Array([1, 0]);
      if (typeof state.notifyCharacteristic.writeValueWithResponse === 'function') {
        await state.notifyCharacteristic.writeValueWithResponse(bytes);
      } else {
        await state.notifyCharacteristic.writeValue(bytes);
      }
    `, REQUEST_TIMEOUT_MS)
  }

  async send(frame: Buffer): Promise<void> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw new Error('DJI Bluetooth：要发送的 DUML 帧无效')
    await this.ensureConnected()
    const quiet = decoded.message.cmdSet === 0x00 && decoded.message.cmdId === 0x2b
    if (!quiet) logMainDebug('[DJI BLE] Web Bluetooth 发送 DUML', { deviceId: this.profile.deviceId, ...djiMessageDetails(decoded.message) })
    const payload = [...frame]
    await this.executeOperation('write', `
      const state = window.__lunaDjiBluetoothState;
      if (!state || state.token !== ${scriptValue(this.token)}) throw new Error('蓝牙会话不存在');
      const bytes = new Uint8Array(${scriptValue(payload)});
      if (typeof state.writeCharacteristic.writeValueWithoutResponse === 'function') {
        await state.writeCharacteristic.writeValueWithoutResponse(bytes);
      } else {
        await state.writeCharacteristic.writeValue(bytes);
      }
    `, REQUEST_TIMEOUT_MS, !quiet)
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw new Error('DJI Bluetooth：要发送的 DUML 帧无效')
    const response = this.waitForMessage(
      (message) => message.cmdSet === decoded.message.cmdSet && message.cmdId === decoded.message.cmdId,
      REQUEST_TIMEOUT_MS,
    )
    await this.send(frame)
    return [await response]
  }

  async waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    const queuedIndex = this.queuedMessages.findIndex(predicate)
    if (queuedIndex >= 0) return this.queuedMessages.splice(queuedIndex, 1)[0]
    if (this.closed) return Promise.reject(new Error('DJI Bluetooth：BLE 会话已关闭'))
    return new Promise<DjiMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.messageWaiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.messageWaiters.splice(index, 1)
        logMainWarn('[DJI BLE] Web Bluetooth 等待通知响应超时', {
          deviceId: this.profile.deviceId,
          timeoutMs,
          queuedMessages: this.queuedMessages.length,
        })
        reject(new Error('DJI Bluetooth：等待 DJI BLE 响应超时'))
      }, timeoutMs)
      this.messageWaiters.push({ predicate, resolve, reject, timer })
    })
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
    this.selectionCancel?.()
    this.selectionCancel = null
    activeTransports.delete(this.token)
    this.rejectPending(new Error('DJI Bluetooth：BLE 会话已关闭'))
    logMainDebug('[DJI BLE] 关闭 Electron Web Bluetooth 会话', { deviceId: this.profile.deviceId, token: this.token })
    try {
      await withTimeout(this.execute(`
        const state = window.__lunaDjiBluetoothState;
        if (state && state.token === ${scriptValue(this.token)}) {
          for (const item of state.notificationHandlers) item.characteristic.removeEventListener('characteristicvaluechanged', item.handler);
          state.device.removeEventListener('gattserverdisconnected', state.disconnectHandler);
          try { if (state.device.gatt?.connected) state.device.gatt.disconnect(); } catch (_) {}
          window.__lunaDjiBluetoothState = null;
        }
      `), CLEANUP_TIMEOUT_MS, '关闭蓝牙会话超时')
    } catch (error) {
      logMainWarn('[DJI BLE] Web Bluetooth 会话清理失败', {
        deviceId: this.profile.deviceId,
        ...djiErrorDetails(error),
      })
    }
    this.connected = false
  }

  handleRendererEvent(event: DjiBluetoothRendererEvent): void {
    if (event.event === 'stage') {
      logMainInfo('[DJI BLE] Web Bluetooth 页面阶段', {
        deviceId: this.profile.deviceId,
        stage: event.message,
      })
      return
    }
    if (event.event === 'disconnected') {
      this.handleProcessError(new Error(event.message || '蓝牙设备已断开'))
      return
    }
    if (!event.payloadHex) return
    logMainDebug('[DJI BLE] Web Bluetooth 收到通知', {
      deviceId: this.profile.deviceId,
      characteristic: event.characteristic,
      payloadBytes: event.payloadHex.length / 2,
    })
    this.consumeNotification(Buffer.from(event.payloadHex, 'hex'))
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return
    if (this.closed) throw new Error('DJI Bluetooth：BLE 会话已关闭')
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('DJI Bluetooth：主窗口不可用')
    installDjiWebBluetoothHandlers(win)
    this.selectionCancel = beginSelection(win.webContents, this.profile)
    const startedAt = Date.now()
    logMainInfo('[DJI BLE] 开始 Web Bluetooth 连接', {
      deviceId: this.profile.deviceId,
      token: this.token,
      namePrefixes: this.profile.ble.namePrefixes,
      excludedNamePrefixes: this.profile.ble.excludedNamePrefixes,
      serviceUuid: this.profile.ble.serviceUuid,
      timeoutMs: CONNECT_TIMEOUT_MS,
    })
    try {
      const result = await withTimeout(
        this.execute(buildDjiWebBluetoothConnectScript(this.token, this.profile), true) as Promise<ConnectResult>,
        CONNECT_TIMEOUT_MS,
        'Web Bluetooth 连接超时，请确认相机已开机且靠近电脑',
      )
      this.connected = true
      logMainInfo('[DJI BLE] Web Bluetooth 连接准备完成', {
        deviceId: this.profile.deviceId,
        bluetoothDeviceId: result.deviceId,
        deviceName: result.deviceName,
        source: result.source,
        serviceUuid: result.serviceUuid,
        writeCharacteristicUuid: result.writeCharacteristicUuid,
        notifyCharacteristicUuid: result.notifyCharacteristicUuid,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      logMainError('[DJI BLE] Web Bluetooth 连接失败', {
        deviceId: this.profile.deviceId,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      await this.cleanupRendererState().catch(() => undefined)
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.selectionCancel?.()
      this.selectionCancel = null
    }
  }

  private async execute(code: string, userGesture = false): Promise<unknown> {
    const contents = this.window?.webContents
    if (!contents || contents.isDestroyed()) throw new Error('主窗口不可用')
    return contents.executeJavaScript(code, userGesture)
  }

  private async executeOperation(command: string, code: string, timeoutMs: number, logLifecycle = true): Promise<void> {
    const startedAt = Date.now()
    if (logLifecycle) logMainDebug('[DJI BLE] Web Bluetooth 操作开始', { deviceId: this.profile.deviceId, command, timeoutMs })
    try {
      const operation = this.execute(`(async () => { ${code} })()`)
      await withTimeout(operation, timeoutMs, `Web Bluetooth ${command} 操作超时`)
      if (logLifecycle) logMainDebug('[DJI BLE] Web Bluetooth 操作完成', { deviceId: this.profile.deviceId, command, elapsedMs: Date.now() - startedAt })
    } catch (error) {
      if (logLifecycle) logMainWarn('[DJI BLE] Web Bluetooth 操作失败', { deviceId: this.profile.deviceId, command, elapsedMs: Date.now() - startedAt, ...djiErrorDetails(error) })
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private async cleanupRendererState(): Promise<void> {
    await withTimeout(this.execute(`
      const state = window.__lunaDjiBluetoothState;
      if (state && state.token === ${scriptValue(this.token)}) {
        for (const item of state.notificationHandlers) item.characteristic.removeEventListener('characteristicvaluechanged', item.handler);
        state.device.removeEventListener('gattserverdisconnected', state.disconnectHandler);
        try { if (state.device.gatt?.connected) state.device.gatt.disconnect(); } catch (_) {}
        window.__lunaDjiBluetoothState = null;
      }
    `), CLEANUP_TIMEOUT_MS, '清理蓝牙会话超时')
  }

  private consumeNotification(chunk: Buffer): void {
    let data = Buffer.concat([this.notificationBuffer, chunk])
    while (data.length > 0) {
      const start = data.indexOf(0x55)
      if (start < 0) {
        this.notificationBuffer = Buffer.alloc(0)
        return
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

  private enqueueMessage(message: DjiMessage): void {
    if (message.flags === 0x40) {
      void this.send(responseToDjiRequest(message)).catch((error: unknown) => {
        this.handleProcessError(error instanceof Error ? error : new Error(String(error)))
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

  private handleProcessError(error: Error): void {
    this.connected = false
    logMainError('[DJI BLE] Web Bluetooth 传输发生错误', { deviceId: this.profile.deviceId, ...djiErrorDetails(error) })
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.messageWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.messageWaiters.length = 0
  }
}

export function createElectronDjiBleTransport(deviceId: string, win: BrowserWindow | null): WebBluetoothDjiBleTransport | null {
  return (process.platform === 'darwin' || process.platform === 'win32') && win
    ? new WebBluetoothDjiBleTransport(deviceId, win)
    : null
}

interface MessageWaiter {
  predicate: (message: DjiMessage) => boolean
  resolve: (message: DjiMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

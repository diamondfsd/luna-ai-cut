import type { BrowserWindow } from 'electron'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  buildCheckAuthorizationRequest,
  buildDirectMessagePacket,
  buildEncryptedMessagePacket,
  buildGetOptionsRequest,
  buildMessageContent,
  buildRequestAuthorizationRequest,
  encryptedMessageAad,
  LunaCryptoSession,
  LUNA_AUTHORIZATION,
  LUNA_COMMAND,
  LUNA_OPTION,
  parseAuthorizationNotification,
  parseCheckAuthorizationResponse,
  parseDecryptedMessage,
  parseDirectMessagePacket,
  parseEncryptCapabilityResponse,
  parseEncryptKeyExchangeResponse,
  parseEncryptedMessagePacket,
  parseGetOptionsResponse,
  type LunaMessage,
  type LunaWifiCredentials,
} from './lunaBleCodec'
import { createElectronLunaBleTransport, type LunaBleTransport } from './lunaBleWebBluetoothTransport'

const FIRST_NOTIFY_TIMEOUT_MS = 5_000
const RESPONSE_TIMEOUT_MS = 12_000
const AUTHORIZATION_TIMEOUT_MS = 20_000

const INITIAL_OPTIONS_A = [30, 19, 37, 22, 67, 97, 89, 116, 115, 114, 110, 85, 156, 135, 103, 150]
const INITIAL_OPTIONS_B = [149, 11, 147, 167, 157, 158, 180, 20, 165]

export interface LunaBleSessionOptions {
  deviceId: string
  win: BrowserWindow | null
  authorizationId?: string
  transport?: LunaBleTransport | null
}

function timeoutError(message: string): Error {
  return new Error(message)
}

/**
 * Luna BLE business session. The GATT adapter only transports bytes; this
 * class owns message IDs, response matching, authorization, and encryption.
 */
export class LunaBleSession {
  private readonly transport: LunaBleTransport
  private readonly deviceId: string
  private readonly authorizationId: string
  private readonly messages: LunaMessage[] = []
  private readonly waiters: Array<MessageWaiter> = []
  private readonly pendingCodes = new Map<number, number>()
  private receiveBuffer = Buffer.alloc(0)
  private firstNotify: Promise<void>
  private resolveFirstNotify!: () => void
  private rejectFirstNotify!: (error: Error) => void
  private sequence = 0
  private messageId = 0
  private initialized = false
  private closed = false
  private firstNotifySeen = false
  private cryptoSession: LunaCryptoSession | null = null

  constructor(options: LunaBleSessionOptions) {
    this.deviceId = options.deviceId
    this.authorizationId = options.authorizationId ?? options.deviceId
    const transport = options.transport ?? createElectronLunaBleTransport(options.win)
    if (!transport) throw new Error('当前电脑没有可用的 Luna 蓝牙传输')
    this.transport = transport
    this.firstNotify = new Promise<void>((resolve, reject) => {
      this.resolveFirstNotify = resolve
      this.rejectFirstNotify = reject
    })
    // The transport can fail before initialize() starts waiting on this
    // promise. Keep that teardown rejection observed in every lifecycle path.
    this.firstNotify.catch(() => undefined)
    this.transport.onNotification = (data) => this.handleNotification(data)
    this.transport.onError = (error) => this.handleTransportError(error)
  }

  async checkAvailability(): Promise<boolean | null> {
    return this.transport.checkAvailability?.() ?? null
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.closed) throw new Error('Luna 蓝牙会话已关闭')
    await this.transport.connect()
    try {
      await this.withTimeout(this.firstNotify, FIRST_NOTIFY_TIMEOUT_MS, '等待相机蓝牙初始化响应超时')
      this.initialized = true
      logMainInfo('[Luna BLE] 蓝牙协议初始化完成', { deviceId: this.deviceId, transport: 'direct-ucd2' })
    } catch (error) {
      this.rejectFirstNotify(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  async readWifiCredentials(): Promise<LunaWifiCredentials> {
    const startedAt = Date.now()
    await this.initialize()
    logMainInfo('[Luna BLE] 开始读取 Wi-Fi 信息', { deviceId: this.deviceId, transport: 'direct-ucd2' })
    try {
      await this.sendCommand(LUNA_COMMAND.GET_OPTIONS, buildGetOptionsRequest([48, 15, 11]), 'GetOptions(设备信息)')
      const capabilityResponse = await this.sendCommand(LUNA_COMMAND.ENCRYPT_CAPABILITY_QUERY, Buffer.alloc(0), '查询加密能力')
      const schemes = parseEncryptCapabilityResponse(capabilityResponse.content)
      if (!schemes.includes(3)) throw new Error('相机不支持安全的 Wi-Fi 信息读取')

      this.cryptoSession = new LunaCryptoSession()
      const keyResponse = await this.sendCommand(
        LUNA_COMMAND.ENCRYPT_KEY_EXCHANGE,
        Buffer.concat([Buffer.from([0x08, 0x03]), Buffer.from([0x12, 0x41]), this.cryptoSession.publicKey]),
        '交换加密密钥',
      )
      const cameraKey = parseEncryptKeyExchangeResponse(keyResponse.content).publicKey
      if (!cameraKey) throw new Error('相机没有返回加密密钥')
      this.cryptoSession.complete(cameraKey)

      await this.sendCommand(
        LUNA_COMMAND.GET_OPTIONS,
        buildGetOptionsRequest(INITIAL_OPTIONS_A),
        'GetOptions(初始化 A)',
      )
      await this.sendCommand(
        LUNA_COMMAND.GET_OPTIONS,
        buildGetOptionsRequest(INITIAL_OPTIONS_B),
        'GetOptions(初始化 B)',
      )

      const authorized = await this.checkAuthorization()
      if (!authorized) throw new Error(authorized === false ? '相机拒绝读取 Wi-Fi 信息' : '等待相机授权超时')

      const response = await this.sendEncryptedCommand(
        LUNA_COMMAND.GET_OPTIONS,
        buildGetOptionsRequest([LUNA_OPTION.WIFI_INFO, LUNA_OPTION.WIFI_CHANNEL_LIST, LUNA_OPTION.WIFI_STATUS]),
        'GetOptions(Wi-Fi 信息)',
      )
      const wifi = parseGetOptionsResponse(response.content).wifiInfo
      if (!wifi) throw new Error('相机没有返回 Wi-Fi 信息')
      logMainInfo('[Luna BLE] Wi-Fi 信息读取成功', {
        deviceId: this.deviceId,
        ssid: wifi.ssid,
        ssidLength: wifi.ssid.length,
        passwordLength: wifi.password.length,
        elapsedMs: Date.now() - startedAt,
      })
      return wifi
    } catch (error) {
      logMainWarn('[Luna BLE] Wi-Fi 信息读取失败', {
        deviceId: this.deviceId,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('Luna 蓝牙会话已关闭'))
    await this.transport.close()
  }

  private async checkAuthorization(): Promise<boolean | null> {
    const response = await this.sendCommand(
      LUNA_COMMAND.CHECK_AUTHORIZATION,
      buildCheckAuthorizationRequest(this.authorizationId),
      '检查相机授权',
    )
    const status = parseCheckAuthorizationResponse(response.content).status
    if (status === LUNA_AUTHORIZATION.SUCCESS) return true
    if (status !== 1) return false

    await this.sendCommand(
      LUNA_COMMAND.REQUEST_AUTHORIZATION,
      buildRequestAuthorizationRequest(),
      '请求读取 Wi-Fi 权限',
    )
    logMainInfo('[Luna BLE] 等待相机确认 Wi-Fi 权限', { deviceId: this.deviceId, timeoutMs: AUTHORIZATION_TIMEOUT_MS })
    const notification = await this.waitForMessage(
      (message) => message.messageCode === LUNA_COMMAND.AUTHORIZATION_RESULT || message.messageCode === LUNA_COMMAND.AUTHORIZATION_CHECK_RESULT,
      AUTHORIZATION_TIMEOUT_MS,
    )
    if (!notification) return null
    const result = parseAuthorizationNotification(notification.content)
    if (result.operation !== LUNA_AUTHORIZATION.WIFI_PASSWORD && result.operation !== 0) return null
    if (result.result === LUNA_AUTHORIZATION.SUCCESS) return true
    if (result.result === LUNA_AUTHORIZATION.REJECTED || result.result === LUNA_AUTHORIZATION.BUSY) return false
    return null
  }

  private nextMessageId(): number {
    this.messageId = this.messageId >= 0x3ffffffe ? 1 : this.messageId + 1
    return this.messageId
  }

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) & 0xff
    return this.sequence
  }

  private async sendCommand(code: number, content: Buffer, label: string): Promise<LunaMessage> {
    const id = this.nextMessageId()
    this.pendingCodes.set(id, code)
    const response = this.waitForMessage((message) => message.messageId === id, RESPONSE_TIMEOUT_MS)
    try {
      const frame = buildDirectMessagePacket(code, content, id, this.nextSequence())
      await this.transport.send(frame, label)
      const result = await response
      if (!result) throw new Error(`等待 Luna 蓝牙响应超时（消息 ${code}）`)
      return result
    } catch (error) {
      this.pendingCodes.delete(id)
      throw error
    }
  }

  private async sendEncryptedCommand(code: number, content: Buffer, label: string): Promise<LunaMessage> {
    if (!this.cryptoSession) throw new Error('Luna BLE 加密会话尚未建立')
    const id = this.nextMessageId()
    this.pendingCodes.set(id, code)
    const sequence = this.nextSequence()
    const plaintext = buildMessageContent(code, content, id)
    const aad = encryptedMessageAad(sequence, plaintext.length)
    const encrypted = this.cryptoSession.encrypt(plaintext, aad)
    const response = this.waitForMessage((message) => message.messageId === id, RESPONSE_TIMEOUT_MS)
    try {
      await this.transport.send(buildEncryptedMessagePacket(encrypted.ciphertext, encrypted.nonce, encrypted.authTag, sequence), label)
      const result = await response
      if (!result) throw new Error(`等待 Luna 蓝牙响应超时（消息 ${code}）`)
      return result
    } catch (error) {
      this.pendingCodes.delete(id)
      throw error
    }
  }

  private waitForMessage(predicate: (message: LunaMessage) => boolean, timeoutMs: number): Promise<LunaMessage | null> {
    const queuedIndex = this.messages.findIndex(predicate)
    if (queuedIndex >= 0) return Promise.resolve(this.messages.splice(queuedIndex, 1)[0])
    if (this.closed) return Promise.reject(new Error('Luna 蓝牙会话已关闭'))
    return new Promise<LunaMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(null)
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, timer })
    })
  }

  private handleNotification(chunk: Buffer): void {
    if (!this.firstNotifySeen) {
      this.firstNotifySeen = true
      this.resolveFirstNotify()
    }
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk])
    this.consumeFrames()
  }

  private consumeFrames(): void {
    while (this.receiveBuffer.length >= 3) {
      if (this.receiveBuffer.subarray(0, 4).toString('ascii') === 'UCD2') {
        if (this.receiveBuffer.length < 8) return
        const type = this.receiveBuffer[6]
        if (type === 5) {
          // STREAM is the camera's initialization heartbeat and has no length
          // field. It is only relevant for first-notify detection.
          this.receiveBuffer = Buffer.alloc(0)
          return
        }
        if (type !== 4 || this.receiveBuffer.length < 12) return
        const headerLength = this.receiveBuffer[5]
        const payloadLength = this.receiveBuffer.readUInt32LE(8)
        const totalLength = headerLength === 0x0c ? 12 + payloadLength + 4 : headerLength + payloadLength + 4
        if (totalLength < 25 || totalLength > 1024 * 1024) {
          this.receiveBuffer = this.receiveBuffer.subarray(1)
          continue
        }
        if (this.receiveBuffer.length < totalLength) return
        const frame = this.receiveBuffer.subarray(0, totalLength)
        this.receiveBuffer = this.receiveBuffer.subarray(totalLength)
        try {
          if (headerLength === 0x0c) {
            const message = parseDirectMessagePacket(frame)
            if (message) this.publishMessage(message)
          } else {
            const encrypted = parseEncryptedMessagePacket(frame)
            if (encrypted && this.cryptoSession) this.publishMessage(parseDecryptedMessage(this.cryptoSession.decrypt(encrypted)))
          }
        } catch (error) {
          logMainWarn('[Luna BLE] 丢弃无效蓝牙消息', { deviceId: this.deviceId, error: error instanceof Error ? error.message : String(error) })
        }
        continue
      }

      const ucd2Index = this.receiveBuffer.indexOf('UCD2')
      if (ucd2Index < 0) {
        this.receiveBuffer = this.receiveBuffer.subarray(Math.max(0, this.receiveBuffer.length - 3))
        return
      }
      this.receiveBuffer = this.receiveBuffer.subarray(ucd2Index)
    }
  }

  private publishMessage(message: LunaMessage): void {
    if (message.wireMessageCode === 200) {
      message = { ...message, messageCode: this.pendingCodes.get(message.messageId) ?? message.wireMessageCode }
      this.pendingCodes.delete(message.messageId)
    }

    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const waiter = this.waiters.splice(waiterIndex, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.messages.push(message)
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError(message)), timeoutMs)
      promise.then((value) => {
        clearTimeout(timer)
        resolve(value)
      }, (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(null)
    }
    this.waiters.length = 0
    this.rejectFirstNotify(error)
  }

  private handleTransportError(error: Error): void {
    this.closed = true
    this.rejectPending(error)
  }
}

interface MessageWaiter {
  predicate: (message: LunaMessage) => boolean
  resolve: (message: LunaMessage | null) => void
  timer: NodeJS.Timeout
}

export function createLunaBleSession(deviceId: string, win: BrowserWindow | null): LunaBleSession | null {
  try {
    return new LunaBleSession({ deviceId, win })
  } catch {
    return null
  }
}

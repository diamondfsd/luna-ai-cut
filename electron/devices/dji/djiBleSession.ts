import { decodeDjiMessage, encodeDjiMessage, packString, readPackString, responseToDjiRequest, type DjiMessage } from './djiBytes'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import { djiErrorDetails, djiMessageDetails } from './djiLog'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

const TARGET_APP_TO_WIFI = 0x0702
const TARGET_APP_TO_SESSION = 0xf002
const TARGET_APP_TO_1C = 0x1c02
const TOKEN = 'osmo'

export interface DjiWifiCredentials {
  ssid: string
  password: string
}

export interface DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer
  /** Returns false when the host has no usable Bluetooth adapter; null means unknown. */
  checkAvailability?(): Promise<boolean | null>
  armPairing(): Promise<void>
  send(frame: Buffer): Promise<void>
  exchange(frame: Buffer): Promise<DjiMessage[]>
  waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage>
  waitForPairingConfirmation(): Promise<DjiMessage | null>
  close(): Promise<void>
}

function command(target: number, id: number, cmdSet: number, cmdId: number, payload = Buffer.alloc(0)): Buffer {
  return encodeDjiMessage({ target, id, cmdSet, cmdId, flags: 0x40, payload })
}

function packPairingPayload(identity: string): Buffer {
  return Buffer.concat([packString(identity), packString(TOKEN)])
}

function parseCredentialPayload(payload: Buffer): string {
  const first = readPackString(payload, payload[0] === 0 ? 1 : 0)
  if (!first) throw new Error('DJI 返回的连接信息格式无效')
  return first.value
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes('超时')
}

export class DjiBleSession {
  private keepAliveTimer: NodeJS.Timeout | null = null
  private activated = false

  constructor(
    private readonly transport: DjiBleTransport,
    private readonly installIdentity: string,
  ) {}

  async checkAvailability(): Promise<boolean | null> {
    return this.transport.checkAvailability?.() ?? null
  }

  /**
   * Keep the BLE session alive after the wake command. The camera can expose the
   * credentials while still leaving its Wi-Fi AP asleep, so this must happen
   * before the host attempts to join Wi-Fi.
   */
  async activate(): Promise<void> {
    if (this.activated) {
      logMainDebug('[DJI BLE] 激活已完成，复用当前 BLE 会话', { deviceId: this.transport.profile.deviceId })
      return
    }

    const startedAt = Date.now()
    const deviceId = this.transport.profile.deviceId
    logMainInfo('[DJI BLE] 激活开始', {
      deviceId,
      transport: this.transport.constructor.name,
      platform: process.platform,
    })
    try {
      const stageStartedAt = Date.now()
      logMainInfo('[DJI BLE] 发送 FFF4 授权准备', { deviceId })
      await this.transport.armPairing()
      logMainInfo('[DJI BLE] FFF4 授权准备完成', { deviceId, elapsedMs: Date.now() - stageStartedAt })

      const wakeStartedAt = Date.now()
      logMainInfo('[DJI BLE] 发送会话唤醒 00/2b 0400', { deviceId })
      await this.transport.send(command(TARGET_APP_TO_SESSION, 0x802b, 0x00, 0x2b, Buffer.from([0x04, 0x00])))
      await sleep(120)
      logMainInfo('[DJI BLE] 会话唤醒完成', { deviceId, elapsedMs: Date.now() - wakeStartedAt })

      const pairingStartedAt = Date.now()
      logMainInfo('[DJI BLE] 发送配对授权 07/45', { deviceId, timeoutMs: 30000 })
      const pairingFrame = command(TARGET_APP_TO_WIFI, 0x8092, 0x07, 0x45, packPairingPayload(this.installIdentity))
      let pairReply: DjiMessage | null = null
      const deadline = Date.now() + 30000
      let pairingAttempts = 0
      while (!pairReply && Date.now() < deadline) {
        pairingAttempts += 1
        try {
          pairReply = await this.sendAndWait(pairingFrame, (message) => message.cmdSet === 0x07 && message.cmdId === 0x45, 3000)
        } catch (error) {
          if (!isTimeout(error)) throw error
          logMainWarn('[DJI BLE] 配对授权等待超时，准备重试', {
            deviceId,
            attempt: pairingAttempts,
            remainingMs: Math.max(0, deadline - Date.now()),
          })
        }
      }
      if (!pairReply) throw new Error('DJI 相机配对响应超时')
      const pairStatus = pairReply.payload[1] ?? pairReply.payload[0] ?? 0xff
      logMainInfo('[DJI BLE] 收到配对响应', {
        deviceId,
        status: pairStatus,
        payloadBytes: pairReply.payload.length,
        attempts: pairingAttempts,
        elapsedMs: Date.now() - pairingStartedAt,
      })
      if (pairStatus === 0x02) {
        const confirmationStartedAt = Date.now()
        logMainInfo('[DJI BLE] 等待相机确认配对', { deviceId, timeoutMs: 15000 })
        const confirmation = await this.transport.waitForPairingConfirmation()
        if (!confirmation) throw new Error('等待相机确认配对超时')
        logMainInfo('[DJI BLE] 相机配对确认完成', {
          deviceId,
          ...djiMessageDetails(confirmation),
          elapsedMs: Date.now() - confirmationStartedAt,
        })
      } else if (pairStatus !== 0x01 && pairStatus !== 0x00) {
        throw new Error(`DJI 相机拒绝配对（状态 ${pairStatus}）`)
      }

      await sleep(100)
      const finalWakeStartedAt = Date.now()
      logMainInfo('[DJI BLE] 授权完成，发送 53/10 唤醒', { deviceId })
      await this.transport.send(command(TARGET_APP_TO_1C, 0x8053, 0x53, 0x10, Buffer.from([0, 0, 0, 0])))
      // Pocket 4 does not reliably answer 53/10. Osmosis proceeds on the
      // command write and queries Wi-Fi shortly afterwards instead of waiting
      // for a response that is not required for the following requests.
      await sleep(120)
      logMainInfo('[DJI BLE] 53/10 唤醒完成', { deviceId, elapsedMs: Date.now() - finalWakeStartedAt })
      this.activated = true
      this.startKeepAlive()
      logMainInfo('[DJI BLE] 激活完成', { deviceId, elapsedMs: Date.now() - startedAt })
    } catch (error) {
      this.activated = false
      logMainError('[DJI BLE] 激活失败', { deviceId, elapsedMs: Date.now() - startedAt, ...djiErrorDetails(error) })
      throw error
    }
  }

  async readWifiCredentials(): Promise<DjiWifiCredentials> {
    const startedAt = Date.now()
    const deviceId = this.transport.profile.deviceId
    logMainInfo('[DJI BLE] 开始读取 Wi-Fi 信息', { deviceId })
    try {
      await this.activate()
      await sleep(100)

      const ssidStartedAt = Date.now()
      logMainInfo('[DJI BLE] 获取 Wi-Fi 名称 07/07', { deviceId })
      const ssidMessage = await this.sendAndWait(command(TARGET_APP_TO_WIFI, 0x8007, 0x07, 0x07), (message) => message.cmdSet === 0x07 && message.cmdId === 0x07)
      const ssid = parseCredentialPayload(ssidMessage.payload)
      logMainInfo('[DJI BLE] Wi-Fi 名称读取完成', {
        deviceId,
        ssid,
        ssidLength: ssid.length,
        payloadBytes: ssidMessage.payload.length,
        elapsedMs: Date.now() - ssidStartedAt,
      })
      await sleep(160)

      const passwordStartedAt = Date.now()
      logMainInfo('[DJI BLE] 获取 Wi-Fi 密码 07/0e', { deviceId })
      const passwordMessage = await this.sendAndWait(command(TARGET_APP_TO_WIFI, 0x800e, 0x07, 0x0e), (message) => message.cmdSet === 0x07 && message.cmdId === 0x0e)
      const password = parseCredentialPayload(passwordMessage.payload)
      logMainInfo('[DJI BLE] Wi-Fi 密码读取完成（内容已隐藏）', {
        deviceId,
        passwordLength: password.length,
        payloadBytes: passwordMessage.payload.length,
        elapsedMs: Date.now() - passwordStartedAt,
      })
      await this.transport.send(command(TARGET_APP_TO_WIFI, 0x800c, 0x07, 0x0c)).catch((error) => {
        logMainWarn('[DJI BLE] 发送 Wi-Fi 信息读取结束命令失败', { deviceId, ...djiErrorDetails(error) })
      })
      // The reference helper exits shortly after both fields are received. The
      // Wi-Fi session has its own keep-alive, so BLE no longer needs a 1-second
      // heartbeat once credentials have been read.
      this.stopKeepAlive()

      logMainInfo('[DJI BLE] Wi-Fi 信息读取完成', { deviceId, ssid, elapsedMs: Date.now() - startedAt })
      return { ssid, password }
    } catch (error) {
      logMainError('[DJI BLE] Wi-Fi 信息读取失败', { deviceId, elapsedMs: Date.now() - startedAt, ...djiErrorDetails(error) })
      throw error
    }
  }

  private async sendAndWait(frame: Buffer, predicate: (message: DjiMessage) => boolean, timeoutMs = 12000): Promise<DjiMessage> {
    const decoded = decodeDjiMessage(frame)
    const commandDetails = decoded ? djiMessageDetails(decoded.message) : { payloadBytes: frame.length }
    const startedAt = Date.now()
    logMainDebug('[DJI BLE] 发送命令并等待响应', { deviceId: this.transport.profile.deviceId, ...commandDetails, timeoutMs })
    try {
      const response = this.transport.waitForMessage(predicate, timeoutMs)
      await this.transport.send(frame)
      const result = await response
      logMainDebug('[DJI BLE] 收到命令响应', {
        deviceId: this.transport.profile.deviceId,
        ...djiMessageDetails(result),
        elapsedMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      logMainWarn('[DJI BLE] 命令等待响应失败', {
        deviceId: this.transport.profile.deviceId,
        ...commandDetails,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }

  private startKeepAlive(): void {
    if (this.keepAliveTimer) return
    logMainDebug('[DJI BLE] 开始发送会话保活', { deviceId: this.transport.profile.deviceId, intervalMs: 1000 })
    const send = (): void => {
      void this.transport.send(command(TARGET_APP_TO_SESSION, 0x802b, 0x00, 0x2b, Buffer.from([0x01, 0x01]))).catch(() => undefined)
    }
    send()
    this.keepAliveTimer = setInterval(send, 1000)
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveTimer) return
    clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
    logMainDebug('[DJI BLE] 已停止会话保活', { deviceId: this.transport.profile.deviceId })
  }

  get profile(): DjiModelProfile {
    return this.transport.profile
  }

  async close(): Promise<void> {
    logMainDebug('[DJI BLE] 关闭 BLE 会话', { deviceId: this.transport.profile.deviceId })
    this.stopKeepAlive()
    await this.transport.close()
  }
}

/** Mock BLE adapter used by the acceptance service. It exercises the same DUML messages as hardware. */
export class MockDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer
  private paired = false
  private armed = false
  private readonly queuedMessages: DjiMessage[] = []
  private readonly waiters: Array<{ predicate: (message: DjiMessage) => boolean; resolve: (message: DjiMessage) => void; timer: NodeJS.Timeout }> = []

  constructor(deviceId: string, private readonly credentials: DjiWifiCredentials = { ssid: 'DJI-Pocket4-Mock', password: 'pocket4-mock-pass' }) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
  }

  async armPairing(): Promise<void> {
    this.armed = true
  }

  async send(frame: Buffer): Promise<void> {
    const replies = await this.exchangeFrame(frame)
    for (const reply of replies) this.enqueue(reply)
    for (const reply of replies.filter((message) => message.flags === 0x40)) {
      const responseReplies = await this.exchangeFrame(responseToDjiRequest(reply))
      for (const responseReply of responseReplies) this.enqueue(responseReply)
    }
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw new Error('模拟 BLE 收到无效 DUML 帧')
    const response = this.waitForMessage((message) => message.cmdSet === decoded.message.cmdSet && message.cmdId === decoded.message.cmdId, 12000)
    await this.send(frame)
    return [await response]
  }

  async waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    const index = this.queuedMessages.findIndex(predicate)
    if (index >= 0) return this.queuedMessages.splice(index, 1)[0]
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
        reject(new Error('等待模拟 DJI BLE 响应超时'))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, timer })
    })
  }

  async waitForPairingConfirmation(): Promise<DjiMessage | null> {
    return this.waitForMessage((message) => message.cmdSet === 0x07 && message.cmdId === 0x46 && message.flags === 0x40, 15000)
  }

  private async exchangeFrame(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw new Error('模拟 BLE 收到无效 DUML 帧')
    const request = decoded.message
    if (!this.armed) throw new Error('模拟 BLE 尚未执行 fff4 配对准备')
    const response = (cmdSet: number, cmdId: number, payload: Buffer, flags = 0xc0): DjiMessage => ({
      target: request.target,
      id: request.id,
      flags,
      cmdSet,
      cmdId,
      payload,
    })

    if (request.cmdSet === 0x07 && request.cmdId === 0x45) {
      const identity = readPackString(request.payload, 0)
      const token = identity ? readPackString(request.payload, identity.next) : null
      if (!token || token.value !== TOKEN) return [response(0x07, 0x45, Buffer.from([0, 0xe0]))]
      if (this.paired) return [response(0x07, 0x45, Buffer.from([0, 1]))]
      this.paired = true
      return [
        response(0x07, 0x45, Buffer.from([0, 2])),
        response(0x07, 0x46, Buffer.from([0, 0]), 0x40),
      ]
    }
    if (request.cmdSet === 0x07 && request.cmdId === 0x07) return [response(0x07, 0x07, Buffer.concat([Buffer.from([0]), packString(this.credentials.ssid)]))]
    if (request.cmdSet === 0x07 && request.cmdId === 0x0e) return [response(0x07, 0x0e, Buffer.concat([Buffer.from([0]), packString(this.credentials.password)]))]
    if (request.cmdSet === 0x53 && request.cmdId === 0x10) return [response(0x53, 0x10, Buffer.from([1, 0, 0, 0]))]
    if (request.cmdSet === 0x00 && request.cmdId === 0x2b) return [response(0x00, 0x2b, Buffer.from([0]))]
    return [response(request.cmdSet, request.cmdId, Buffer.from([0, 0]))]
  }

  async close(): Promise<void> {
    this.armed = false
    for (const waiter of this.waiters) clearTimeout(waiter.timer)
    this.waiters.length = 0
  }

  private enqueue(message: DjiMessage): void {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) {
      const waiter = this.waiters.splice(index, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.queuedMessages.push(message)
  }
}

/** HTTP bridge to dji_mock_server; the BLE command bytes still use the production DUML state machine. */
export class HttpMockDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer
  private readonly queuedMessages: DjiMessage[] = []
  private readonly waiters: Array<{ predicate: (message: DjiMessage) => boolean; resolve: (message: DjiMessage) => void; timer: NodeJS.Timeout }> = []

  constructor(deviceId: string, private readonly baseUrl: string) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
  }

  async armPairing(): Promise<void> {
    await this.call('/ble/arm', 'POST')
  }

  async send(frame: Buffer): Promise<void> {
    const result = await this.call('/ble/exchange', 'POST', { frameHex: frame.toString('hex') }) as { framesHex?: string[] }
    const replies = (result.framesHex ?? []).flatMap((value) => {
      const decoded = decodeDjiMessage(Buffer.from(value, 'hex'))
      return decoded ? [decoded.message] : []
    })
    for (const reply of replies) this.enqueue(reply)
    for (const reply of replies.filter((message) => message.flags === 0x40)) {
      await this.send(responseToDjiRequest(reply))
    }
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const decoded = decodeDjiMessage(frame)
    if (!decoded) throw new Error('模拟 BLE 收到无效 DUML 帧')
    const response = this.waitForMessage((message) => message.cmdSet === decoded.message.cmdSet && message.cmdId === decoded.message.cmdId, 12000)
    await this.send(frame)
    return [await response]
  }

  async waitForMessage(predicate: (message: DjiMessage) => boolean, timeoutMs: number): Promise<DjiMessage> {
    const index = this.queuedMessages.findIndex(predicate)
    if (index >= 0) return this.queuedMessages.splice(index, 1)[0]
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
        reject(new Error('等待模拟 DJI BLE 响应超时'))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, timer })
    })
  }

  async waitForPairingConfirmation(): Promise<DjiMessage | null> {
    await this.call('/ble/confirm', 'POST')
    return this.waitForMessage((message) => message.cmdSet === 0x07 && message.cmdId === 0x46 && message.flags === 0x40, 15000)
  }

  async close(): Promise<void> {
    for (const waiter of this.waiters) clearTimeout(waiter.timer)
    this.waiters.length = 0
  }

  private enqueue(message: DjiMessage): void {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) {
      const waiter = this.waiters.splice(index, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.queuedMessages.push(message)
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error(`DJI mock BLE 请求失败（${response.status}）`)
    return response.json()
  }
}

export function createMockDjiBleTransport(deviceId: string): MockDjiBleTransport {
  return new MockDjiBleTransport(deviceId)
}

export function createHttpMockDjiBleTransport(deviceId: string, baseUrl: string): HttpMockDjiBleTransport {
  return new HttpMockDjiBleTransport(deviceId, baseUrl)
}

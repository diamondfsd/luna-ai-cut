import { decodeDjiMessage, encodeDjiMessage, packString, readPackString, type DjiMessage } from './djiBytes'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'

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
  armPairing(): Promise<void>
  exchange(frame: Buffer): Promise<DjiMessage[]>
  waitForPairingConfirmation(): Promise<void>
  close(): Promise<void>
}

function command(target: number, id: number, cmdSet: number, cmdId: number, payload = Buffer.alloc(0)): Buffer {
  return encodeDjiMessage({ target, id, cmdSet, cmdId, flags: 0x40, payload })
}

function responseFor(messages: DjiMessage[], cmdSet: number, cmdId: number): DjiMessage | null {
  return messages.find((message) => message.cmdSet === cmdSet && message.cmdId === cmdId) ?? null
}

function packPairingPayload(identity: string): Buffer {
  return Buffer.concat([packString(identity), packString(TOKEN)])
}

function parseCredentialPayload(payload: Buffer): string {
  const first = readPackString(payload, payload[0] === 0 ? 1 : 0)
  if (!first) throw new Error('DJI 返回的连接信息格式无效')
  return first.value
}

export class DjiBleSession {
  constructor(
    private readonly transport: DjiBleTransport,
    private readonly installIdentity: string,
  ) {}

  async readWifiCredentials(): Promise<DjiWifiCredentials> {
    await this.transport.armPairing()

    await this.transport.exchange(command(TARGET_APP_TO_SESSION, 0x802b, 0x00, 0x2b, Buffer.from([0x04, 0x00])))

    const pairReplies = await this.transport.exchange(
      command(TARGET_APP_TO_WIFI, 0x8092, 0x07, 0x45, packPairingPayload(this.installIdentity)),
    )
    const pairReply = responseFor(pairReplies, 0x07, 0x45)
    const pairStatus = pairReply?.payload[1] ?? pairReply?.payload[0] ?? 0xff
    if (pairStatus === 0x02) {
      await this.transport.waitForPairingConfirmation()
      const approval = pairReplies.find((message) => message.cmdSet === 0x07 && message.cmdId === 0x46 && message.flags === 0x40)
      if (approval) {
        await this.transport.exchange(command(TARGET_APP_TO_WIFI, approval.id, 0x07, 0x46, Buffer.from([0x00])))
      }
    } else if (pairStatus !== 0x01 && pairStatus !== 0x00) {
      throw new Error(`DJI 相机拒绝配对（状态 ${pairStatus}）`)
    }

    await this.transport.exchange(command(TARGET_APP_TO_1C, 0x8053, 0x53, 0x10, Buffer.from([0, 0, 0, 0])))
    await this.transport.exchange(command(TARGET_APP_TO_SESSION, 0x802b, 0x00, 0x2b, Buffer.from([0x01, 0x01])))

    const ssidReply = await this.transport.exchange(command(TARGET_APP_TO_WIFI, 0x8007, 0x07, 0x07))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const passwordReply = await this.transport.exchange(command(TARGET_APP_TO_WIFI, 0x800e, 0x07, 0x0e))
    const ssidMessage = responseFor(ssidReply, 0x07, 0x07)
    const passwordMessage = responseFor(passwordReply, 0x07, 0x0e)
    if (!ssidMessage || !passwordMessage) throw new Error('DJI 相机没有返回 Wi-Fi 连接信息')

    return {
      ssid: parseCredentialPayload(ssidMessage.payload),
      password: parseCredentialPayload(passwordMessage.payload),
    }
  }

  get profile(): DjiModelProfile {
    return this.transport.profile
  }

  async close(): Promise<void> {
    await this.transport.close()
  }
}

/** Mock BLE adapter used by the acceptance service. It exercises the same DUML messages as hardware. */
export class MockDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer
  private paired = false
  private armed = false

  constructor(deviceId: string, private readonly credentials: DjiWifiCredentials = { ssid: 'DJI-Pocket4-Mock', password: 'pocket4-mock-pass' }) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
  }

  async armPairing(): Promise<void> {
    this.armed = true
  }

  async waitForPairingConfirmation(): Promise<void> {
    this.paired = true
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
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
  }
}

/** HTTP bridge to dji_mock_server; the BLE command bytes still use the production DUML state machine. */
export class HttpMockDjiBleTransport implements DjiBleTransport {
  readonly profile: DjiModelProfile
  readonly advertisement: Buffer

  constructor(deviceId: string, private readonly baseUrl: string) {
    this.profile = djiProfileForDevice(deviceId)
    this.advertisement = this.profile.advertisement
  }

  async armPairing(): Promise<void> {
    await this.call('/ble/arm', 'POST')
  }

  async exchange(frame: Buffer): Promise<DjiMessage[]> {
    const result = await this.call('/ble/exchange', 'POST', { frameHex: frame.toString('hex') }) as { framesHex?: string[] }
    return (result.framesHex ?? []).flatMap((value) => {
      const decoded = decodeDjiMessage(Buffer.from(value, 'hex'))
      return decoded ? [decoded.message] : []
    })
  }

  async waitForPairingConfirmation(): Promise<void> {
    await this.call('/ble/confirm', 'POST')
  }

  async close(): Promise<void> {}

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

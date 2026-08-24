import type {
  CameraMediaSourceConnectionCapabilities,
  CameraMediaSourceOptions,
} from '../../src/shared/types'
import {
  createHttpMockDjiBleTransport,
  DjiBleSession,
  type DjiBleTransport,
  type DjiWifiCredentials,
} from './djiBleSession'

export type DjiWirelessPreparationMode = 'bluetooth' | 'manual-wifi' | 'already-connected'

export interface DjiWirelessPreparationResult {
  mode: DjiWirelessPreparationMode
  credentials?: DjiWifiCredentials
  message: string
}

export interface DjiWirelessPreparation {
  readonly capabilities: CameraMediaSourceConnectionCapabilities
  prepare(options: CameraMediaSourceOptions): Promise<DjiWirelessPreparationResult>
  close(): Promise<void>
}

function isLoopbackHost(host: string): boolean {
  try {
    return ['127.0.0.1', 'localhost'].includes(new URL(host.includes('://') ? host : `http://${host}`).hostname)
  } catch {
    return false
  }
}

/**
 * DJI 的媒体会话只消费连接准备结果，不直接依赖某一种 BLE 实现。
 * 真实 CoreBluetooth transport 接入后，只需要替换 transportFactory。
 */
export class DefaultDjiWirelessPreparation implements DjiWirelessPreparation {
  private ble: DjiBleSession | null = null

  constructor(
    private readonly deviceId: string,
    private readonly host: string,
    private readonly installIdentity: string,
    private readonly transportFactory: ((deviceId: string, baseUrl: string) => DjiBleTransport | null) = (deviceId, baseUrl) => (
      isLoopbackHost(baseUrl) ? createHttpMockDjiBleTransport(deviceId, baseUrl) : null
    ),
  ) {}

  get capabilities(): CameraMediaSourceConnectionCapabilities {
    const bluetoothAvailable = Boolean(this.transportFactory(this.deviceId, this.host))
    return {
      bluetoothActivation: bluetoothAvailable,
      bluetoothWifiCredentials: bluetoothAvailable,
      automaticWifiJoin: false,
      manualWifiCredentials: true,
    }
  }

  async prepare(options: CameraMediaSourceOptions): Promise<DjiWirelessPreparationResult> {
    const wireless = options.wireless
    if (wireless?.autoJoin) {
      throw new Error('DJI 当前不支持由应用自动切换 Wi-Fi，请先在系统中连接相机 Wi-Fi')
    }

    const manualSsid = wireless?.ssid?.trim()
    const manualPassword = wireless?.password
    if (wireless?.preparation === 'manual-wifi' || manualSsid || manualPassword) {
      return {
        mode: 'manual-wifi',
        credentials: manualSsid ? { ssid: manualSsid, password: manualPassword ?? '' } : undefined,
        message: manualSsid ? `已使用手动连接的 Wi-Fi：${manualSsid}` : '已使用当前 Wi-Fi 连接',
      }
    }

    const baseUrl = this.host.includes('://') ? this.host : `http://${this.host}`
    const transport = this.transportFactory(this.deviceId, baseUrl)
    if (!transport) {
      return {
        mode: 'already-connected',
        message: '已使用当前 Wi-Fi 连接；如需蓝牙取回 Wi-Fi 信息，请接入 DJI 蓝牙适配器',
      }
    }

    this.ble = new DjiBleSession(transport, this.installIdentity)
    const credentials = await this.ble.readWifiCredentials()
    return {
      mode: 'bluetooth',
      credentials,
      message: `已通过蓝牙取得 Wi-Fi 信息：${credentials.ssid}`,
    }
  }

  async close(): Promise<void> {
    if (!this.ble) return
    await this.ble.close()
    this.ble = null
  }
}

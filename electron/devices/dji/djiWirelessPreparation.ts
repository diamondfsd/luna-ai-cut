import type {
  CameraMediaSourceConnectionCapabilities,
  CameraMediaSourceOptions,
  CameraMediaSourceWirelessPreparation,
} from '../../../src/shared/types'
import {
  createHttpMockDjiBleTransport,
  DjiBleSession,
  type DjiBleTransport,
  type DjiWifiCredentials,
} from './djiBleSession'
import { createCoreBluetoothDjiBleTransport } from './djiCoreBluetoothTransport'
import { createWindowsDjiBleTransport } from './djiWindowsBluetoothTransport'

export type DjiWirelessPreparationMode = CameraMediaSourceWirelessPreparation

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

type DjiTransportFactory = (deviceId: string, baseUrl: string) => DjiBleTransport | null

function defaultDjiTransportFactory(deviceId: string, baseUrl: string): DjiBleTransport | null {
  if (isLoopbackHost(baseUrl)) return createHttpMockDjiBleTransport(deviceId, baseUrl)
  return createCoreBluetoothDjiBleTransport(deviceId) ?? createWindowsDjiBleTransport(deviceId)
}

/**
 * DJI 的媒体会话只消费连接准备结果，不直接依赖某一种 BLE 实现。
 * BLE 只负责激活相机和读取 Wi-Fi 信息；媒体会话本身继续走 Wi-Fi。
 */
export class DefaultDjiWirelessPreparation implements DjiWirelessPreparation {
  private ble: DjiBleSession | null = null

  constructor(
    private readonly deviceId: string,
    private readonly host: string,
    private readonly installIdentity: string,
    private readonly transportFactory: DjiTransportFactory = defaultDjiTransportFactory,
  ) {}

  get capabilities(): CameraMediaSourceConnectionCapabilities {
    const bluetoothAvailable = process.platform === 'darwin' || process.platform === 'win32' || isLoopbackHost(this.host)
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
        message: '当前电脑不支持蓝牙读取 Wi-Fi 信息，建议先让手机连接相机，再用手机系统的 Wi-Fi 分享功能查看或分享密码，然后让电脑连接相机热点并在这里填写',
      }
    }

    const ble = new DjiBleSession(transport, this.installIdentity)
    this.ble = ble
    try {
      const credentials = await ble.readWifiCredentials()
      return {
        mode: 'bluetooth',
        credentials,
        message: `已通过蓝牙取得 Wi-Fi 信息：${credentials.ssid}`,
      }
    } catch {
      return {
        mode: 'manual-wifi',
        message: '未能通过 DJI 蓝牙读取 Wi-Fi 信息，建议先让手机连接相机，再用手机系统的 Wi-Fi 分享功能查看或分享密码，然后让电脑连接相机热点并在这里填写',
      }
    } finally {
      await ble.close().catch(() => undefined)
      if (this.ble === ble) this.ble = null
    }
  }

  async close(): Promise<void> {
    if (!this.ble) return
    await this.ble.close()
    this.ble = null
  }
}

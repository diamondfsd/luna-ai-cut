import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type { BrowserWindow } from 'electron'

import type {
  CameraMediaSourceConnectionCapabilities,
  CameraMediaSourceOptions,
  CameraMediaSourcePreparationResult,
  CameraMediaSourceWirelessPreparation,
} from '../../../src/shared/types'
import { getSettings, saveSettings } from '../../storage/fileService'
import { getWifiDebugStatus } from '../../platform/network/wifiDebugService'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { LunaBleSession } from './lunaBleSession'
import type { LunaWifiCredentials } from './lunaBleCodec'
import { createElectronLunaBleTransport } from './lunaBleWebBluetoothTransport'

const HOST_PROBE_TIMEOUT_MS = 1_200
const MANUAL_WIFI_MESSAGE = '未能通过蓝牙读取相机 Wi-Fi 信息，请打开系统 Wi-Fi 设置手动连接相机热点，连接完成后再点击“开始连接”'

export type LunaWirelessPreparationMode = CameraMediaSourceWirelessPreparation

export interface LunaWirelessPreparation {
  readonly capabilities: CameraMediaSourceConnectionCapabilities
  prepare(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult>
}

function isLoopbackHost(host: string): boolean {
  try {
    const hostname = new URL(host.includes('://') ? host : `http://${host}`).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

function hostParts(host: string): { hostname: string; port: number } | null {
  try {
    const url = new URL(host.includes('://') ? host : `http://${host}`)
    return { hostname: url.hostname, port: Number(url.port || 80) }
  } catch {
    return null
  }
}

function hostReachable(host: string): Promise<boolean> {
  const parts = hostParts(host)
  if (!parts) return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: parts.hostname, port: parts.port, timeout: HOST_PROBE_TIMEOUT_MS })
    const finish = (reachable: boolean): void => {
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function currentLunaWifi(): Promise<string | null> {
  return getWifiDebugStatus()
    .then((result) => result.success ? result.data?.ssid ?? null : null)
    .catch(() => null)
}

async function lunaInstallIdentity(): Promise<string> {
  const settings = await getSettings()
  if (settings.lunaInstallIdentity) return settings.lunaInstallIdentity
  const identity = randomUUID().replace(/-/g, '').slice(0, 32)
  await saveSettings({ lunaInstallIdentity: identity })
  return identity
}

function manualResult(
  message: string,
  capabilities: CameraMediaSourceConnectionCapabilities,
): CameraMediaSourcePreparationResult {
  return {
    mode: 'wireless',
    preparation: 'already-connected',
    requiresManualWifi: true,
    capabilities,
    message,
  }
}

function suppliedCredentials(options: CameraMediaSourceOptions): LunaWifiCredentials | null {
  const ssid = options.wireless?.ssid?.trim()
  if (!ssid) return null
  return { ssid, password: options.wireless?.password ?? '' }
}

/** Reads Luna's Wi-Fi credentials over BLE and leaves network switching to the shared Wi-Fi service. */
export class DefaultLunaWirelessPreparation implements LunaWirelessPreparation {
  private bluetoothAvailable: boolean | null = null

  constructor(
    private readonly deviceId: string,
    private readonly host: string,
    private readonly win: BrowserWindow | null,
  ) {}

  get capabilities(): CameraMediaSourceConnectionCapabilities {
    const platformSupportsBluetooth = process.platform === 'darwin' || process.platform === 'win32' || isLoopbackHost(this.host)
    const bluetoothAvailable = this.bluetoothAvailable ?? platformSupportsBluetooth
    return {
      bluetoothActivation: false,
      bluetoothWifiCredentials: bluetoothAvailable,
      automaticWifiJoin: process.platform === 'darwin' || process.platform === 'win32',
      manualWifiCredentials: true,
    }
  }

  async prepare(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult> {
    const wireless = options.wireless
    const startedAt = Date.now()
    logMainInfo('[Luna Wi-Fi] 连接准备开始', {
      deviceId: this.deviceId,
      host: this.host,
      platform: process.platform,
      preparation: wireless?.preparation ?? 'bluetooth-auto',
      preferExistingConnection: options.preferExistingConnection === true,
      hasSsid: Boolean(wireless?.ssid?.trim()),
      hasPassword: Boolean(wireless?.password),
    })

    if (isLoopbackHost(this.host)) {
      return { mode: 'wireless', preparation: 'already-connected', message: '模拟设备使用本机网络' }
    }

    if (options.preferExistingConnection && await hostReachable(this.host)) {
      const ssid = await currentLunaWifi()
      logMainInfo('[Luna Wi-Fi] 已检测到相机地址可达，跳过蓝牙读取', { deviceId: this.deviceId, host: this.host, ssid })
      return { mode: 'wireless', preparation: 'already-connected', message: '已检测到相机 Wi-Fi 连接，将直接建立相机会话' }
    }

    if (wireless?.preparation === 'already-connected') {
      return { mode: 'wireless', preparation: 'already-connected', message: '已使用当前系统 Wi-Fi 连接' }
    }

    const supplied = suppliedCredentials(options)
    if (supplied) {
      const preparation = wireless?.preparation === 'bluetooth' ? 'bluetooth' : 'manual-wifi'
      return {
        mode: 'wireless',
        preparation,
        credentials: supplied,
        capabilities: this.capabilities,
        message: preparation === 'bluetooth'
          ? `已使用蓝牙取得的 Wi-Fi 信息：${supplied.ssid}`
          : `已使用手动输入的 Wi-Fi：${supplied.ssid}`,
      }
    }

    const transport = createElectronLunaBleTransport(this.win)
    if (!transport) {
      this.bluetoothAvailable = false
      return manualResult(MANUAL_WIFI_MESSAGE, this.capabilities)
    }

    const availability = await transport.checkAvailability()
    if (availability === false) {
      this.bluetoothAvailable = false
      await transport.close().catch(() => undefined)
      return manualResult('未检测到可用的蓝牙适配器，请打开系统 Wi-Fi 设置手动连接相机热点，连接完成后再点击“开始连接”', this.capabilities)
    }
    if (availability === true) this.bluetoothAvailable = true

    const identity = await lunaInstallIdentity()
    const session = new LunaBleSession({ deviceId: this.deviceId, win: this.win, transport, authorizationId: identity })
    try {
      const credentials = await session.readWifiCredentials()
      logMainInfo('[Luna Wi-Fi] 已通过蓝牙读取 Wi-Fi 信息', {
        deviceId: this.deviceId,
        ssid: credentials.ssid,
        passwordLength: credentials.password.length,
        elapsedMs: Date.now() - startedAt,
      })
      return {
        mode: 'wireless',
        preparation: 'bluetooth',
        credentials,
        capabilities: this.capabilities,
        message: `已通过蓝牙取得 Wi-Fi 信息：${credentials.ssid}`,
      }
    } catch (error) {
      logMainWarn('[Luna Wi-Fi] 蓝牙读取 Wi-Fi 信息失败，回退系统 Wi-Fi', {
        deviceId: this.deviceId,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      return manualResult(MANUAL_WIFI_MESSAGE, this.capabilities)
    } finally {
      await session.close().catch(() => undefined)
    }
  }
}

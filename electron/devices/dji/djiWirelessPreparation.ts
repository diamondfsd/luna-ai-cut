import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'

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
import { createElectronDjiBleTransport } from './djiWebBluetoothTransport'
import { djiErrorDetails } from './djiLog'
import { djiProfileForDevice } from './djiModels'
import { connectWifiNetwork, getWifiDebugStatus } from '../../platform/network/wifiDebugService'
import { logMainDebug, logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

const execFileAsync = promisify(execFile)

export type DjiWirelessPreparationMode = CameraMediaSourceWirelessPreparation

export interface DjiWirelessPreparationResult {
  mode: DjiWirelessPreparationMode
  credentials?: DjiWifiCredentials
  requiresManualWifi?: boolean
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

type DjiTransportFactory = (deviceId: string, baseUrl: string, win: BrowserWindow | null) => DjiBleTransport | null

function defaultDjiTransportFactory(deviceId: string, baseUrl: string, win: BrowserWindow | null): DjiBleTransport | null {
  if (isLoopbackHost(baseUrl)) return createHttpMockDjiBleTransport(deviceId, baseUrl)
  return createElectronDjiBleTransport(deviceId, win)
}

function pingArgs(host: string): string[] {
  return process.platform === 'win32'
    ? ['-n', '1', '-w', '700', host]
    : ['-c', '1', '-W', '700', host]
}

const PING_COMMAND_TIMEOUT_MS = 1200
const HOST_REACHABLE_TIMEOUT_MS = 8000
const HOST_REACHABLE_RETRY_DELAY_MS = 150
const MANUAL_WIFI_MESSAGE = '未检测到可用的蓝牙适配器。请打开系统 Wi-Fi 设置，手动连接相机热点；连接完成后返回应用，再点击“开始连接”'

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function waitForDjiHostReachable(host: string, deviceId: string): Promise<void> {
  if (isLoopbackHost(host)) return
  const startedAt = Date.now()
  const deadline = startedAt + HOST_REACHABLE_TIMEOUT_MS
  let lastError = ''
  let attempts = 0
  logMainInfo('[DJI Wi-Fi] 开始探测相机地址', {
    deviceId,
    host,
    timeoutMs: HOST_REACHABLE_TIMEOUT_MS,
    pingTimeoutMs: PING_COMMAND_TIMEOUT_MS,
  })
  while (Date.now() < deadline) {
    attempts += 1
    try {
      await execFileAsync('ping', pingArgs(host), { timeout: PING_COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 64 })
      logMainInfo('[DJI Wi-Fi] 相机地址已可达', {
        deviceId,
        host,
        attempts,
        elapsedMs: Date.now() - startedAt,
      })
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logMainDebug('[DJI Wi-Fi] 相机地址探测失败，继续重试', {
        deviceId,
        host,
        attempt: attempts,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
    }
    await sleep(HOST_REACHABLE_RETRY_DELAY_MS)
  }
  logMainWarn('[DJI Wi-Fi] 相机地址不可达', {
    deviceId,
    host,
    attempts,
    elapsedMs: Date.now() - startedAt,
    error: lastError,
  })
  throw new Error(`相机 Wi-Fi 已切换，但无法访问 ${host}`)
}

async function joinDjiWifi(credentials: DjiWifiCredentials, deviceId: string, host: string): Promise<void> {
  const startedAt = Date.now()
  logMainInfo('[DJI Wi-Fi] 开始切换相机 Wi-Fi', {
    deviceId,
    ssid: credentials.ssid,
    passwordProvided: true,
    strategy: process.platform === 'win32' ? 'netsh-profile' : 'corewlan-password-stdin',
  })
  let result: Awaited<ReturnType<typeof connectWifiNetwork>>
  try {
    result = await connectWifiNetwork({
      ssid: credentials.ssid,
      password: credentials.password,
      timeoutMs: 30000,
      skipSsidVerification: true,
    })
  } catch (error) {
    logMainError('[DJI Wi-Fi] 系统切换 Wi-Fi 异常', {
      deviceId,
      ssid: credentials.ssid,
      elapsedMs: Date.now() - startedAt,
      ...djiErrorDetails(error),
    })
    throw error
  }
  const elapsedMs = Date.now() - startedAt
  logMainInfo('[DJI Wi-Fi] 切换结果', {
    deviceId,
    ssid: credentials.ssid,
    success: result.success,
    code: result.code,
    message: result.message,
    elapsedMs,
    connectedSsid: result.data?.ssid,
  })
  if (!result.success) {
    throw new Error(`无法连接相机 Wi-Fi：${result.message}`)
  }

  try {
    await waitForDjiHostReachable(host, deviceId)
  } catch (error) {
    logMainError('[DJI Wi-Fi] 已执行 Wi-Fi 切换但相机地址不可达', {
      deviceId,
      host,
      ssid: credentials.ssid,
      elapsedMs: Date.now() - startedAt,
      ...djiErrorDetails(error),
    })
    throw error
  }
}

async function isDjiHostReachable(host: string, deviceId: string): Promise<boolean> {
  if (isLoopbackHost(host)) return true
  const startedAt = Date.now()
  try {
    await execFileAsync('ping', pingArgs(host), { timeout: PING_COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 64 })
    logMainDebug('[DJI Wi-Fi] 当前相机地址探测成功', { deviceId, host, elapsedMs: Date.now() - startedAt })
    return true
  } catch (error) {
    logMainDebug('[DJI Wi-Fi] 当前相机地址尚不可达', { deviceId, host, elapsedMs: Date.now() - startedAt, ...djiErrorDetails(error) })
    return false
  }
}

async function currentWindowsWifiSsid(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const status = await getWifiDebugStatus().catch(() => null)
  return status?.success ? status.data?.ssid ?? null : null
}

function isDjiWifiSsid(ssid: string, deviceId: string): boolean {
  const normalized = ssid.trim().toLocaleLowerCase()
  return djiProfileForDevice(deviceId).ble.namePrefixes.some((prefix) => normalized.startsWith(prefix.toLocaleLowerCase()))
}

/**
 * DJI 的媒体会话只消费连接准备结果，不直接依赖某一种 BLE 实现。
 * BLE 只负责激活相机和读取 Wi-Fi 信息；媒体会话本身继续走 Wi-Fi。
 */
export class DefaultDjiWirelessPreparation implements DjiWirelessPreparation {
  private ble: DjiBleSession | null = null
  private bluetoothAvailable: boolean | null = null

  constructor(
    private readonly deviceId: string,
    private readonly host: string,
    private readonly installIdentity: string,
    private readonly transportFactory: DjiTransportFactory = defaultDjiTransportFactory,
    private readonly win: BrowserWindow | null = null,
  ) {}

  get capabilities(): CameraMediaSourceConnectionCapabilities {
    const platformSupportsBluetooth = process.platform === 'darwin' || process.platform === 'win32' || isLoopbackHost(this.host)
    const bluetoothAvailable = this.bluetoothAvailable ?? platformSupportsBluetooth
    return {
      bluetoothActivation: bluetoothAvailable,
      bluetoothWifiCredentials: bluetoothAvailable,
      automaticWifiJoin: process.platform === 'darwin' || process.platform === 'win32',
      manualWifiCredentials: true,
    }
  }

  async prepare(options: CameraMediaSourceOptions): Promise<DjiWirelessPreparationResult> {
    const wireless = options.wireless
    const startedAt = Date.now()
    logMainInfo('[DJI Wi-Fi] 连接准备开始', {
      deviceId: this.deviceId,
      host: this.host,
      platform: process.platform,
      preparation: wireless?.preparation ?? 'bluetooth-auto',
      autoJoin: wireless?.autoJoin === true,
      preferExistingConnection: options.preferExistingConnection === true,
      hasSsid: Boolean(wireless?.ssid?.trim()),
      hasPassword: Boolean(wireless?.password),
    })

    if (options.preferExistingConnection && await isDjiHostReachable(this.host, this.deviceId)) {
      const currentSsid = await currentWindowsWifiSsid()
      if (process.platform !== 'win32' || (currentSsid && isDjiWifiSsid(currentSsid, this.deviceId))) {
        logMainInfo('[DJI Wi-Fi] 已检测到相机地址和当前 Wi-Fi 可用，跳过蓝牙和 Wi-Fi 切换', {
          deviceId: this.deviceId,
          host: this.host,
          ssid: currentSsid,
        })
        return {
          mode: 'already-connected',
          message: '已检测到相机 Wi-Fi 连接，将直接建立相机会话',
        }
      }
      logMainWarn('[DJI Wi-Fi] 相机地址可达但当前 Wi-Fi 不是相机网络，继续读取并切换', {
        deviceId: this.deviceId,
        host: this.host,
        ssid: currentSsid,
      })
    }

    if (wireless?.preparation === 'already-connected') {
      logMainInfo('[DJI Wi-Fi] 使用当前系统 Wi-Fi，跳过蓝牙和自动切换', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
      return {
        mode: 'already-connected',
        message: '已使用当前系统 Wi-Fi 连接',
      }
    }

    const manualSsid = wireless?.ssid?.trim()
    const manualPassword = wireless?.password
    let suppliedCredentials: DjiWifiCredentials | undefined
    if (wireless?.preparation === 'bluetooth' && manualSsid) {
      suppliedCredentials = { ssid: manualSsid, password: manualPassword ?? '' }
    } else if (wireless?.preparation === 'manual-wifi' || manualSsid || manualPassword) {
      suppliedCredentials = manualSsid ? { ssid: manualSsid, password: manualPassword ?? '' } : undefined
    }
    if (suppliedCredentials) {
      logMainInfo('[DJI Wi-Fi] 使用外部提供的 Wi-Fi 信息', {
        deviceId: this.deviceId,
        host: this.host,
        preparation: wireless?.preparation ?? 'manual-wifi',
        autoJoin: wireless?.autoJoin === true,
        ssid: suppliedCredentials.ssid,
        passwordProvided: Boolean(suppliedCredentials.password),
      })
      const hostReachable = wireless?.autoJoin && await isDjiHostReachable(this.host, this.deviceId)
      const currentSsid = await currentWindowsWifiSsid()
      const currentWifiMatches = process.platform === 'win32'
        ? currentSsid === suppliedCredentials.ssid
        : Boolean(hostReachable)
      logMainDebug('[DJI Wi-Fi] 外部 Wi-Fi 信息处理前状态', {
        deviceId: this.deviceId,
        host: this.host,
        hostReachable: Boolean(hostReachable),
        currentSsid,
        currentWifiMatches,
      })
      if (!currentWifiMatches && (wireless?.preparation === 'bluetooth' || wireless?.autoJoin)) {
        const ble = await this.ensureBluetoothSession()
        if (!ble && wireless?.preparation === 'bluetooth') {
          throw new Error('当前电脑无法通过蓝牙激活 DJI 相机')
        }
      }
      if (wireless?.autoJoin) {
        if (!currentWifiMatches) {
          await joinDjiWifi(suppliedCredentials, this.deviceId, this.host)
        } else if (!hostReachable) {
          await waitForDjiHostReachable(this.host, this.deviceId)
        }
        await this.releaseBluetoothSession()
      }
      const mode = wireless?.preparation === 'bluetooth' ? 'bluetooth' : 'manual-wifi'
      logMainInfo('[DJI Wi-Fi] 连接准备完成', {
        deviceId: this.deviceId,
        host: this.host,
        mode,
        autoJoin: wireless?.autoJoin === true,
        hostReachable: Boolean(hostReachable || currentWifiMatches || wireless?.autoJoin),
        elapsedMs: Date.now() - startedAt,
      })
      return {
        mode,
        credentials: suppliedCredentials,
        message: mode === 'bluetooth'
          ? `已使用蓝牙取得的 Wi-Fi 信息：${suppliedCredentials.ssid}`
          : `已使用手动输入的 Wi-Fi：${suppliedCredentials.ssid}`,
      }
    }

    const bluetoothStartedAt = Date.now()
    logMainInfo('[DJI BLE] 开始读取 Wi-Fi 信息', {
      deviceId: this.deviceId,
      host: this.host,
    })
    const baseUrl = this.host.includes('://') ? this.host : `http://${this.host}`
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      logMainInfo(`[DJI BLE] 开始第 ${attempt} 次读取 Wi-Fi 信息`, {
        deviceId: this.deviceId,
        host: this.host,
        attempt,
      })
      const ble = this.ble ?? (() => {
        const transport = this.transportFactory(this.deviceId, baseUrl, this.win)
        return transport ? new DjiBleSession(transport, this.installIdentity) : null
      })()
      if (!ble) {
        this.bluetoothAvailable = false
        logMainWarn('[DJI BLE] 当前平台没有可用的 DJI BLE 传输', {
          deviceId: this.deviceId,
          host: this.host,
          platform: process.platform,
          elapsedMs: Date.now() - startedAt,
        })
        return {
          mode: 'already-connected',
          requiresManualWifi: true,
          message: MANUAL_WIFI_MESSAGE,
        }
      }

      const bluetoothAvailability = await ble.checkAvailability()
      if (bluetoothAvailability === false) {
        this.bluetoothAvailable = false
        await ble.close().catch(() => undefined)
        if (this.ble === ble) this.ble = null
        logMainWarn('[DJI BLE] 当前电脑没有可用的蓝牙适配器', {
          deviceId: this.deviceId,
          host: this.host,
          platform: process.platform,
          elapsedMs: Date.now() - startedAt,
        })
        return {
          mode: 'already-connected',
          requiresManualWifi: true,
          message: MANUAL_WIFI_MESSAGE,
        }
      }
      if (bluetoothAvailability === true) this.bluetoothAvailable = true

      this.ble = ble
      try {
        const credentials = await ble.readWifiCredentials()
        logMainInfo('[DJI BLE] Wi-Fi 信息读取成功', {
          deviceId: this.deviceId,
          ssid: credentials.ssid,
          attempt,
          elapsedMs: Date.now() - bluetoothStartedAt,
        })
        return {
          mode: 'bluetooth',
          credentials,
          message: `已通过蓝牙取得 Wi-Fi 信息：${credentials.ssid}`,
        }
      } catch (error) {
        lastError = error
        logMainWarn('[DJI BLE] 读取相机 Wi-Fi 信息失败', {
          deviceId: this.deviceId,
          host: this.host,
          attempt,
          elapsedMs: Date.now() - bluetoothStartedAt,
          ...djiErrorDetails(error),
        })
        await ble.close().catch(() => undefined)
        if (this.ble === ble) this.ble = null
        if (attempt < 2) await sleep(250)
      }
    }

    logMainWarn('[DJI BLE] 两次读取均失败，回退到系统 Wi-Fi', {
      deviceId: this.deviceId,
      host: this.host,
      elapsedMs: Date.now() - bluetoothStartedAt,
      ...djiErrorDetails(lastError),
    })
    return {
      mode: 'already-connected',
      requiresManualWifi: true,
      message: '未能通过 DJI 蓝牙读取 Wi-Fi 信息，请使用系统 Wi-Fi 工具手动连接相机热点，连接完成后回来点击“开始连接”',
    }
  }

  private async ensureBluetoothSession(): Promise<DjiBleSession | null> {
    const startedAt = Date.now()
    if (this.ble) {
      logMainDebug('[DJI BLE] 复用已有蓝牙会话并确认激活状态', {
        deviceId: this.deviceId,
        host: this.host,
      })
      try {
        await this.ble.activate()
        logMainInfo('[DJI BLE] 蓝牙会话复用完成', {
          deviceId: this.deviceId,
          host: this.host,
          elapsedMs: Date.now() - startedAt,
        })
        return this.ble
      } catch (error) {
        logMainError('[DJI BLE] 复用蓝牙会话失败', {
          deviceId: this.deviceId,
          host: this.host,
          elapsedMs: Date.now() - startedAt,
          ...djiErrorDetails(error),
        })
        throw error
      }
    }

    const baseUrl = this.host.includes('://') ? this.host : `http://${this.host}`
    logMainInfo('[DJI BLE] 创建蓝牙会话并激活相机', {
      deviceId: this.deviceId,
      host: this.host,
      platform: process.platform,
    })
    const transport = this.transportFactory(this.deviceId, baseUrl, this.win)
    if (!transport) {
      logMainWarn('[DJI BLE] 没有可用的蓝牙传输', {
        deviceId: this.deviceId,
        host: this.host,
        platform: process.platform,
        elapsedMs: Date.now() - startedAt,
      })
      return null
    }

    const ble = new DjiBleSession(transport, this.installIdentity)
    this.ble = ble
    try {
      await ble.activate()
      logMainInfo('[DJI BLE] 相机激活完成', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
      return ble
    } catch (error) {
      logMainError('[DJI BLE] 创建蓝牙会话或激活失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      await ble.close().catch(() => undefined)
      if (this.ble === ble) this.ble = null
      throw error
    }
  }

  async close(): Promise<void> {
    logMainDebug('[DJI Wi-Fi] 关闭无线准备会话', {
      deviceId: this.deviceId,
      host: this.host,
      hasBluetoothSession: Boolean(this.ble),
    })
    await this.releaseBluetoothSession()
  }

  private async releaseBluetoothSession(): Promise<void> {
    const ble = this.ble
    if (!ble) {
      logMainDebug('[DJI BLE] 没有需要释放的蓝牙会话', { deviceId: this.deviceId })
      return
    }
    const startedAt = Date.now()
    this.ble = null
    try {
      await ble.close()
      logMainInfo('[DJI BLE] 蓝牙会话已释放', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      logMainError('[DJI BLE] 释放蓝牙会话失败', {
        deviceId: this.deviceId,
        host: this.host,
        elapsedMs: Date.now() - startedAt,
        ...djiErrorDetails(error),
      })
      throw error
    }
  }
}

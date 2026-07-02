import { getSettings, saveSettings } from './fileService'
import { DEFAULT_HOST, LunaClient } from './lunaProtocol'
import { DEFAULT_DEVICE, GO_ULTRA_DEVICE } from './deviceDefaults'
import { GoUltraClient, AuthState } from './goUltraProtocol'
import { logMainInfo, logMainWarn, logMainError } from './loggerService'
import type { ConnectionStatus, DeviceConnectOptions, DeviceDefinition, DeviceStorageOption, LunaFile } from '../src/shared/types'

export interface DeviceProtocol {
  readonly definition: DeviceDefinition
  wakeDevice(): Promise<void>
  checkStatus(host?: string): Promise<ConnectionStatus>
  connect(options?: DeviceConnectOptions): Promise<ConnectionStatus>
  listFiles(options?: DeviceConnectOptions): Promise<LunaFile[]>
  disconnect(host?: string): Promise<void>
}

type ConnectionLostHandler = () => void

function withDeviceInfo(status: ConnectionStatus, definition: DeviceDefinition): ConnectionStatus {
  return {
    ...status,
    deviceId: definition.id,
    deviceName: status.deviceInfo?.deviceName ?? definition.name,
  }
}

// ============================================================
// Luna Ultra 协议实现
// ============================================================

export class LunaUltraProtocol implements DeviceProtocol {
  readonly definition = DEFAULT_DEVICE

  constructor(
    private readonly clientFor: (host?: string, controlPort?: number) => LunaClient,
    private readonly controlPortForHost: (host: string) => number = () => DEFAULT_DEVICE.controlPort,
    private readonly onConnectionLost?: ConnectionLostHandler,
  ) {}

  async wakeDevice(): Promise<void> {
    // Reserved for Bluetooth wake-up / Wi-Fi info discovery on devices that support it.
  }

  async checkStatus(host?: string): Promise<ConnectionStatus> {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost || this.definition.defaultHost
    const client = this.clientFor(normalizedHost, this.controlPortForHost(normalizedHost))
    return withDeviceInfo(await client.checkStatus(), this.definition)
  }

  async connect(options?: DeviceConnectOptions): Promise<ConnectionStatus> {
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    logMainInfo(`[设备协议] 开始连接设备`, { device: this.definition.name, host })
    await this.wakeDevice()
    const client = this.clientFor(host, this.controlPortForHost(host))
    const status = await client.checkStatus()
    logMainInfo(`[设备协议] 端口检测结果`, { host, httpOk: status.httpOk, controlOk: status.controlOk })
    if (!status.controlOk) {
      logMainWarn(`[设备协议] 控制端口检测未通过，放弃连接`, { host, controlOk: status.controlOk })
      return withDeviceInfo(status, this.definition)
    }

    await client.connect()
    const connectedStatus = await client.checkStatus()
    client.onKeepAliveFailed = this.onConnectionLost ?? null
    client.startKeepAlive()
    await saveSettings({
      activeDeviceId: this.definition.id,
      cameraHost: client.host,
    })
    logMainInfo(`[设备协议] 连接完成`, { device: this.definition.name, host })
    return withDeviceInfo({ ...connectedStatus, message: `已连接 ${this.definition.name}` }, this.definition)
  }

  async listFiles(options?: DeviceConnectOptions): Promise<LunaFile[]> {
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    const storageId = options?.storageId ?? settings.deviceStorage?.[this.definition.id] ?? 'all'
    logMainInfo(`[设备协议] 开始读取文件列表`, { host, storageId })
    const client = this.clientFor(host, this.controlPortForHost(host))
    const storages = storageId === 'all'
      ? this.definition.storages
      : this.definition.storages.filter((storage) => storage.id === storageId)
    logMainInfo(`[设备协议] 读取 ${storages.length} 个存储的文件`, { storages: storages.map(s => s.id) })
    const t0 = performance.now()
    const files = await listStorageFiles(client, storages.length > 0 ? storages : this.definition.storages)
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
    logMainInfo(`[设备协议] 文件列表读取完成`, { host, storageId, fileCount: files.length, elapsedSec: elapsed })
    client.startKeepAlive()
    return files
  }

  async disconnect(host?: string): Promise<void> {
    const normalizedHost = host ?? DEFAULT_HOST
    logMainInfo(`[设备协议] 断开设备连接`, { host: normalizedHost })
    const client = this.clientFor(normalizedHost, this.controlPortForHost(normalizedHost))
    client.stopKeepAlive()
    client.close()
  }
}

// ============================================================
// Go Ultra 协议实现
// ============================================================

export class GoUltraProtocol implements DeviceProtocol {
  readonly definition = GO_ULTRA_DEVICE

  constructor(
    private readonly clientFor: (host?: string, port?: number) => GoUltraClient,
    private readonly onConnectionLost?: ConnectionLostHandler,
  ) {}

  async wakeDevice(): Promise<void> {
    // Go Ultra 唤醒逻辑（预留）
  }

  async checkStatus(host?: string): Promise<ConnectionStatus> {
    const settings = await getSettings()
    const normalizedHost = host || settings.cameraHost || this.definition.defaultHost
    const client = this.clientFor(normalizedHost)
    return withDeviceInfo(await client.checkStatus(), this.definition)
  }

  async connect(options?: DeviceConnectOptions): Promise<ConnectionStatus> {
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    logMainInfo(`[GoUltraProtocol] 开始连接`, { device: this.definition.name, host })

    // 端口检测
    const client = this.clientFor(host)
    const status = await client.checkStatus()
    logMainInfo(`[GoUltraProtocol] 端口检测结果`, { host, httpOk: status.httpOk, controlOk: status.controlOk })

    if (!status.httpOk || !status.controlOk) {
      logMainWarn(`[GoUltraProtocol] 端口检测未通过`, { host })
      return withDeviceInfo(status, this.definition)
    }

    try {
      // TCP 连接 + 基础 UCD2 认证 + 授权流程
      client.onConnectionLost = this.onConnectionLost ?? null
      await client.connect()
      logMainInfo(`[GoUltraProtocol] 基础连接完成`, { host })

      // 等待授权结果
      if (client.authState === AuthState.NEED_CAMERA_CONFIRM) {
        logMainInfo(`[GoUltraProtocol] 请在 Go Ultra 相机上确认授权`, { host })
      }

      // 等待授权（非阻塞）
      client.startKeepAlive()

      await saveSettings({
        activeDeviceId: this.definition.id,
        cameraHost: host,
      })

      return withDeviceInfo(
        { ...status, message: `已连接 ${this.definition.name}${client.authState === AuthState.NEED_CAMERA_CONFIRM ? '（等待相机确认授权）' : ''}` },
        this.definition,
      )
    } catch (error) {
      logMainError(`[GoUltraProtocol] 连接失败`, { host, error: String(error) })
      client.close()
      throw error
    }
  }

  async listFiles(options?: DeviceConnectOptions): Promise<LunaFile[]> {
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    logMainInfo(`[GoUltraProtocol] 开始读取文件列表`, { host })

    // 确保授权完成
    const client = this.clientFor(host)
    if (client.authState !== AuthState.AUTHORIZED) {
      // 尝试等待授权
      try {
        const authorized = await client.waitForAuthorization(30000)
        if (!authorized) {
          throw new Error('Go Ultra 未授权，无法读取文件列表。请在相机屏幕上确认授权。')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('超时')) {
          throw new Error('Go Ultra 授权超时，请在相机屏幕上确认授权后重试。')
        }
        throw error
      }
    }

    const files = await client.listFiles()
    return files.map((f) => ({
      ...f,
      id: `go-ultra:${f.name}`,
      storageId: 'internal',
    }))
  }

  async disconnect(host?: string): Promise<void> {
    const normalizedHost = host ?? GO_ULTRA_DEVICE.defaultHost
    logMainInfo(`[GoUltraProtocol] 断开连接`, { host: normalizedHost })
    const client = this.clientFor(normalizedHost)
    client.stopKeepAlive()
    client.close()
  }
}

// ============================================================
// 根据设备 ID 获取协议实现
// ============================================================

export function protocolForDevice(
  deviceId: string,
  lunaClientFactory: (host?: string, controlPort?: number) => LunaClient,
  goUltraClientFactory: (host?: string, port?: number) => GoUltraClient,
  controlPortForHost: (host: string) => number,
  onConnectionLost?: ConnectionLostHandler,
): DeviceProtocol {
  switch (deviceId) {
    case 'go-ultra':
      return new GoUltraProtocol(goUltraClientFactory, onConnectionLost)
    case 'luna-ultra':
    default:
      return new LunaUltraProtocol(lunaClientFactory, controlPortForHost, onConnectionLost)
  }
}

// ============================================================
// 公共辅助函数
// ============================================================

async function listStorageFiles(client: LunaClient, storages: DeviceStorageOption[]): Promise<LunaFile[]> {
  const results = await Promise.allSettled(storages.map(async (storage) => {
    logMainInfo(`[存储读取] 开始读取存储`, { storageId: storage.id, label: storage.label })
    const files = await client.listFiles(storage.id)
    logMainInfo(`[存储读取] 存储读取完成`, { storageId: storage.id, label: storage.label, fileCount: files.length })
    return files.map((file) => ({
      ...file,
      id: `${storage.id}:${file.id}`,
      storageId: storage.id,
      storageLabel: storage.label,
    }))
  }))

  const groups: LunaFile[][] = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      groups.push(result.value)
    } else {
      const storageId = storages[index]?.id ?? 'unknown'
      logMainWarn(`[存储读取] 存储不可用`, { storageId, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) })
    }
  }

  return groups.flat().sort((a, b) => {
    const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
    const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
    return bTime - aTime || a.name.localeCompare(b.name)
  })
}

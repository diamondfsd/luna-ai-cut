import { getSettings, saveSettings } from './fileService'
import { DEFAULT_HOST, LunaClient } from './lunaProtocol'
import { DEFAULT_DEVICE } from './deviceDefaults'
import { logMainInfo, logMainWarn } from './loggerService'
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
    if (!status.httpOk || !status.controlOk) {
      logMainWarn(`[设备协议] 端口检测未通过，放弃连接`, { host, httpOk: status.httpOk, controlOk: status.controlOk })
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

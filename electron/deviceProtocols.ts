import { getSettings, saveSettings } from './fileService'
import { DEFAULT_HOST, LunaClient } from './lunaProtocol'
import { DEFAULT_DEVICE } from './deviceDefaults'
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
    deviceName: definition.name,
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
    await this.wakeDevice()
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    const client = this.clientFor(host, this.controlPortForHost(host))
    const status = await client.checkStatus()
    if (!status.httpOk || !status.controlOk) return withDeviceInfo(status, this.definition)

    await client.connect()
    client.onKeepAliveFailed = this.onConnectionLost ?? null
    client.startKeepAlive()
    await saveSettings({
      activeDeviceId: this.definition.id,
      cameraHost: client.host,
    })
    return withDeviceInfo({ ...status, message: `已连接 ${this.definition.name}` }, this.definition)
  }

  async listFiles(options?: DeviceConnectOptions): Promise<LunaFile[]> {
    const settings = await getSettings()
    const host = options?.host || settings.cameraHost || this.definition.defaultHost
    const storageId = options?.storageId ?? settings.deviceStorage?.[this.definition.id] ?? 'all'
    const client = this.clientFor(host, this.controlPortForHost(host))
    const storages = storageId === 'all'
      ? this.definition.storages
      : this.definition.storages.filter((storage) => storage.id === storageId)
    const files = await listStorageFiles(client, storages.length > 0 ? storages : this.definition.storages)
    client.startKeepAlive()
    return files
  }

  async disconnect(host?: string): Promise<void> {
    const normalizedHost = host ?? DEFAULT_HOST
    const client = this.clientFor(normalizedHost, this.controlPortForHost(normalizedHost))
    client.stopKeepAlive()
    client.close()
  }
}

async function listStorageFiles(client: LunaClient, storages: DeviceStorageOption[]): Promise<LunaFile[]> {
  const results = await Promise.allSettled(storages.map(async (storage) => {
    const files = await client.listFiles(storage.id)
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
      console.warn(`[device] storage unavailable: ${storages[index]?.id ?? 'unknown'}`, result.reason)
    }
  }

  return groups.flat().sort((a, b) => {
    const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
    const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
    return bTime - aTime || a.name.localeCompare(b.name)
  })
}

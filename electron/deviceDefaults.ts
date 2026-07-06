import lunaUltraConfig from './deviceConfigs/luna-ultra.json'
import goUltraConfig from './deviceConfigs/go-ultra.json'
import type { DeviceDefinition } from '../src/shared/types'
import { scanUsbStorageVolumes, usbStorageOptions } from './usbStorageService'

export const DEFAULT_DEVICE = lunaUltraConfig as DeviceDefinition
export const GO_ULTRA_DEVICE = goUltraConfig as DeviceDefinition

/** 通过 deviceId 获取设备定义 */
export function deviceDefinitionFor(deviceId?: string): DeviceDefinition {
  switch (deviceId) {
    case 'go-ultra':
      return GO_ULTRA_DEVICE
    case 'luna-ultra':
    default:
      return DEFAULT_DEVICE
  }
}

/** 获取所有支持的设备列表 */
export function deviceDefinitions(): DeviceDefinition[] {
  return [
    DEFAULT_DEVICE,
    GO_ULTRA_DEVICE,
  ]
}

export async function deviceDefinitionsWithUsbStorage(): Promise<DeviceDefinition[]> {
  const definitions = deviceDefinitions().map((device) => ({ ...device, storages: [...device.storages] }))
  if (process.platform !== 'win32') return definitions

  const volumes = await scanUsbStorageVolumes().catch(() => [])
  if (volumes.length === 0) return definitions

  return definitions.map((device) => {
    if (device.id !== DEFAULT_DEVICE.id) return device
    const dynamicOptions = usbStorageOptions(volumes)
    const existing = new Map(device.storages.map((storage) => [storage.id, storage]))
    for (const option of dynamicOptions) existing.set(option.id, option)
    return { ...device, storages: [...existing.values()] }
  })
}

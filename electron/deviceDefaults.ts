import lunaUltraConfig from './deviceConfigs/luna-ultra.json'
import type { DeviceDefinition } from '../src/shared/types'

export const DEFAULT_DEVICE = lunaUltraConfig as DeviceDefinition

export function deviceDefinitions(): DeviceDefinition[] {
  return [DEFAULT_DEVICE]
}

export function deviceDefinitionFor(deviceId?: string): DeviceDefinition {
  return deviceDefinitions().find((device) => device.id === deviceId) ?? DEFAULT_DEVICE
}

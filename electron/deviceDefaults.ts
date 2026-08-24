import lunaUltraConfig from './deviceConfigs/luna-ultra.json'
import goUltraConfig from './deviceConfigs/go-ultra.json'
import pocket4Config from './deviceConfigs/pocket-4.json'
import pocket4ProConfig from './deviceConfigs/pocket-4-pro.json'
import type { DeviceDefinition } from '../src/shared/types'

export const DEFAULT_DEVICE = lunaUltraConfig as DeviceDefinition
export const GO_ULTRA_DEVICE = goUltraConfig as DeviceDefinition
export const POCKET_4_DEVICE = pocket4Config as DeviceDefinition
export const POCKET_4_PRO_DEVICE = pocket4ProConfig as DeviceDefinition

/** 通过 deviceId 获取设备定义 */
export function deviceDefinitionFor(deviceId?: string): DeviceDefinition {
  switch (deviceId) {
    case 'go-ultra':
      return GO_ULTRA_DEVICE
    case 'dji-pocket-4':
      return POCKET_4_DEVICE
    case 'dji-pocket-4-pro':
      return POCKET_4_PRO_DEVICE
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
    POCKET_4_DEVICE,
    POCKET_4_PRO_DEVICE,
  ]
}

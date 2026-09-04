import lunaUltraConfig from './configs/luna-ultra.json'
import lunaProConfig from './configs/luna-pro.json'
import goUltraConfig from './configs/go-ultra.json'
import pocket3Config from './configs/pocket-3.json'
import pocket4Config from './configs/pocket-4.json'
import pocket4ProConfig from './configs/pocket-4-pro.json'
import action5ProConfig from './configs/action-5-pro.json'
import type { DeviceDefinition } from '../../../src/shared/types'

export const DEFAULT_DEVICE = lunaUltraConfig as DeviceDefinition
export const LUNA_PRO_DEVICE = lunaProConfig as DeviceDefinition
export const GO_ULTRA_DEVICE = goUltraConfig as DeviceDefinition
export const POCKET_3_DEVICE = pocket3Config as DeviceDefinition
export const POCKET_4_DEVICE = pocket4Config as DeviceDefinition
export const POCKET_4_PRO_DEVICE = pocket4ProConfig as DeviceDefinition
export const ACTION_5_PRO_DEVICE = action5ProConfig as DeviceDefinition

/** 通过 deviceId 获取设备定义 */
export function deviceDefinitionFor(deviceId?: string): DeviceDefinition {
  switch (deviceId) {
    case 'go-ultra':
      return GO_ULTRA_DEVICE
    case 'dji-pocket-3':
      return POCKET_3_DEVICE
    case 'dji-pocket-4':
      return POCKET_4_DEVICE
    case 'dji-pocket-4-pro':
      return POCKET_4_PRO_DEVICE
    case 'dji-action-5-pro':
      return ACTION_5_PRO_DEVICE
    case 'luna-pro':
      return LUNA_PRO_DEVICE
    case 'luna-ultra':
    default:
      return DEFAULT_DEVICE
  }
}

/** 获取所有支持的设备列表 */
export function deviceDefinitions(): DeviceDefinition[] {
  return allDeviceDefinitions().filter((device) => device.connectionSupported !== false)
}

/** 包含暂未开放连接的设备，供资源注册等内部用途使用。 */
export function allDeviceDefinitions(): DeviceDefinition[] {
  return [
    DEFAULT_DEVICE,
    LUNA_PRO_DEVICE,
    GO_ULTRA_DEVICE,
    POCKET_3_DEVICE,
    POCKET_4_DEVICE,
    POCKET_4_PRO_DEVICE,
    ACTION_5_PRO_DEVICE,
  ]
}

export function assertDeviceConnectionSupported(deviceId: string): void {
  const device = deviceDefinitionFor(deviceId)
  if (device.connectionSupported === false) throw new Error(`${device.name} 暂不支持连接`)
}

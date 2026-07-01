/**
 * 设备调试协议注册表
 *
 * 根据 deviceId 创建对应的调试协议适配器实例
 */

import type { IDeviceDebugProtocol } from './deviceDebugProtocol'
import { LunaDebugAdapter } from './lunaDebugAdapter'
import { GoUltraDebugAdapter } from './goUltraDebugAdapter'

/** 支持的设备类型列表（用于调试页面下拉选择） */
export interface DebugDeviceOption {
  id: string
  name: string
  defaultHost: string
  controlPort: number
  needsAuth: boolean
  protocolType: string
}

/** 所有支持的调试设备 */
export const DEBUG_DEVICE_OPTIONS: DebugDeviceOption[] = [
  {
    id: 'go-ultra',
    name: 'GO Ultra (TC4)',
    defaultHost: '192.168.42.1',
    controlPort: 6666,
    needsAuth: true,
    protocolType: 'UCD2 + 授权流程',
  },
  {
    id: 'luna-ultra',
    name: 'Luna Ultra',
    defaultHost: '192.168.42.1',
    controlPort: 6666,
    needsAuth: false,
    protocolType: 'UCD2 基础认证',
  },
]

/** 根据 deviceId 获取调试协议适配器实例 */
export function createDebugProtocol(deviceId: string): IDeviceDebugProtocol {
  switch (deviceId) {
    case 'go-ultra':
      return new GoUltraDebugAdapter()
    case 'luna-ultra':
      return new LunaDebugAdapter()
    default:
      throw new Error(`不支持的设备类型: ${deviceId}`)
  }
}

/** 清理所有调试协议的全局资源 */
export function cleanupAllDebugProtocols(): void {
  GoUltraDebugAdapter.cleanupAll()
}

import type { IDeviceDebugProtocol } from './deviceDebugProtocol'
import { Insta360DebugAdapter } from './insta360DebugAdapter'

export interface DebugDeviceOption {
  id: string
  name: string
  defaultHost: string
  controlPort: number
  needsAuth: boolean
  protocolType: string
}

export const DEBUG_DEVICE_OPTIONS: DebugDeviceOption[] = [
  {
    id: 'luna-ultra',
    name: 'Luna Ultra',
    defaultHost: '192.168.42.1',
    controlPort: 6666,
    needsAuth: true,
    protocolType: 'Insta360 UCD2 TCP + MSG 授权',
  },
  {
    id: 'go-ultra',
    name: 'GO Ultra / Insta360 通用',
    defaultHost: '192.168.42.1',
    controlPort: 6666,
    needsAuth: true,
    protocolType: 'Insta360 UCD2 TCP + MSG 授权',
  },
]

export function createDebugProtocol(deviceId: string): IDeviceDebugProtocol {
  const option = DEBUG_DEVICE_OPTIONS.find((item) => item.id === deviceId)
  if (!option) throw new Error(`不支持的设备类型: ${deviceId}`)
  return new Insta360DebugAdapter(option.id, option.name, option.controlPort)
}

export function cleanupAllDebugProtocols(): void {
  // 当前通用调试适配器无全局资源。
}

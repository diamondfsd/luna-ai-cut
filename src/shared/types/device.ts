import type { WatermarkStyle } from './watermark'

export interface DeviceWatermarkStyleConfig {
  value: WatermarkStyle
  label: string
  /** 视频水印文件名（不含路径和扩展名） */
  videoFileName: string
  /** 图片水印文件名（不含路径和扩展名） */
  imageFileName: string
}

export interface DeviceStorageOption {
  id: string
  label: string
  path: string
  default?: boolean
}

export interface Insta360DeviceInfo {
  serial?: string
  deviceName?: string
  firmware?: string
  ssid?: string
  wifiPassword?: string
  rawStrings: string[]
}

export interface ConnectionStatus {
  deviceId?: string
  deviceName?: string
  deviceInfo?: Insta360DeviceInfo
  host: string
  httpOk: boolean
  controlOk: boolean
  message: string
}

export type DeviceConnectionPhase = 'idle' | 'checking' | 'connected' | 'error'

export interface DeviceDefinition {
  id: string
  name: string
  vendor: string
  defaultHost: string
  httpPort: number
  controlPort: number
  mock: {
    host: string
    httpPort: number
    tcpPort: number
    rateMbps: number
  }
  bluetooth?: {
    namePrefixes: string[]
    scanServiceUuids: string[]
    optionalServiceUuids: string[]
    serviceUuid: string
    writeCharacteristicUuid: string
    notifyCharacteristicUuid: string
    wakePayloadHex: string
  }
  storages: DeviceStorageOption[]
  /** 设备可选水印样式列表 */
  watermarkStyles?: DeviceWatermarkStyleConfig[]
}

export interface DeviceConnectOptions {
  deviceId?: string
  host?: string
  storageId?: string
}

export interface BluetoothDeviceCandidate {
  deviceId: string
  deviceName: string
  rssi?: number
  serviceUuids?: string[]
  localName?: string
}

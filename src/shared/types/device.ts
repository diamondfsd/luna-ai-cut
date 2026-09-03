import type { WatermarkStyle } from './watermark'
import type { CameraMediaSourceCapabilities } from './cameraMediaSource'

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

export interface DeviceLutRestoreConfig {
  /** 内置 LUT 文件名；实际文件位于应用的 luts 资源目录中。 */
  fileName: string
  /** 面板中显示的还原方式名称。 */
  label: string
  description?: string
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
  diagnosticsRaw?: string
  wifiSsid?: string
  wifiPasswordRequired?: boolean
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
  /** 未完成真机验证的设备保留定义，但不展示为可连接设备。 */
  connectionSupported?: boolean
  defaultHost: string
  httpPort: number
  controlPort: number
  mock: {
    host: string
    httpPort: number
    tcpPort: number
    udpPort?: number
    rateMbps: number
    model?: string
  }
  protocol?: 'insta360' | 'go-ultra' | 'dji'
  /** 设备 Wi-Fi 的自动发现与连接策略，由设备定义提供。 */
  wifi?: {
    autoJoin?: boolean
    ssidIncludes: string[]
  }
  mediaCapabilities?: Partial<Pick<CameraMediaSourceCapabilities, 'list' | 'preview' | 'copyToLocal' | 'create' | 'update' | 'delete' | 'watch'>>
  bluetooth?: {
    namePrefixes?: string[]
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
  /** 设备专用的 Log 还原 LUT。未配置表示该设备暂不支持 LUT 还原。 */
  lut?: {
    restore?: DeviceLutRestoreConfig
  }
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
  manufacturerData?: string
  manufacturerText?: string
}

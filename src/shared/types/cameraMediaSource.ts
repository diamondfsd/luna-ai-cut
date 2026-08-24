import type { ConnectionStatus } from './device'
import type { CameraDeleteResult, LunaFile } from './media'

export type CameraConnectionMode = 'wireless' | 'wired'

export interface CameraMediaSourceConnectionCapabilities {
  /** 设备是否需要或支持通过蓝牙唤醒/激活无线连接。 */
  bluetoothActivation: boolean
  /** 设备是否可以通过蓝牙读取 Wi-Fi 名称和密码。 */
  bluetoothWifiCredentials: boolean
  /** 适配器是否会主动调用系统加入 Wi-Fi。 */
  automaticWifiJoin: boolean
  /** 用户是否可以在应用外手动连好 Wi-Fi 后继续使用媒体服务。 */
  manualWifiCredentials: boolean
}

export interface CameraMediaSourceCapabilities {
  list: boolean
  preview: boolean
  copyToLocal: boolean
  create: boolean
  update: boolean
  delete: boolean
  watch: boolean
  connection: CameraMediaSourceConnectionCapabilities
}

export interface CameraMediaSourcePreparationResult {
  mode: CameraConnectionMode
  credentials?: {
    ssid: string
    password: string
  }
  message: string
}

export interface MountedCameraVolume {
  id: string
  label: string
  rootPath: string
  mediaRoots: string[]
  mediaCount: number
}

export interface CameraMediaSourceOptions {
  mode: CameraConnectionMode
  deviceId?: string
  host?: string
  storageId?: string
  rootPath?: string
  wireless?: {
    /** 只表示连接准备方式，不会把密码写入应用设置。 */
    preparation?: 'bluetooth' | 'manual-wifi' | 'already-connected'
    ssid?: string
    password?: string
    /** 预留给未来的系统 Wi-Fi 自动加入能力，默认关闭。 */
    autoJoin?: boolean
  }
}

export interface CameraMediaSourceStatus extends ConnectionStatus {
  mode: CameraConnectionMode
  connected: boolean
  sourceId: string
  rootPath?: string
  volumeLabel?: string
  capabilities: CameraMediaSourceCapabilities
}

/**
 * Electron 主进程内的统一媒体适配器契约。
 * 具体设备可以拥有不同的连接准备流程，但媒体操作保持一致。
 */
export interface CameraMediaSourceAdapter {
  connect(): Promise<CameraMediaSourceStatus>
  check(): Promise<CameraMediaSourceStatus>
  listFiles(): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult>
  disconnect(): Promise<void>
  prepareConnection?(): Promise<CameraMediaSourcePreparationResult>
}

export interface CameraMediaSourceApi {
  detectMounted(): Promise<MountedCameraVolume[]>
  chooseMounted(): Promise<MountedCameraVolume | null>
  connect(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult>
  check(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  listFiles(options: CameraMediaSourceOptions): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[], options: CameraMediaSourceOptions): Promise<CameraDeleteResult>
  disconnect(options: CameraMediaSourceOptions): Promise<void>
}

import type { ConnectionStatus } from './device'
import type { CameraDeleteResult, LunaFile } from './media'

export type CameraConnectionMode = 'wireless' | 'wired'

export type CameraMediaSourceWirelessPreparation = 'bluetooth' | 'manual-wifi' | 'already-connected'

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
  preparation?: CameraMediaSourceWirelessPreparation
  credentials?: {
    ssid: string
    password: string
  }
  capabilities?: CameraMediaSourceConnectionCapabilities
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
  /** 连接入口可先探测相机地址，避免已连通时重复走蓝牙和 Wi-Fi 切换。 */
  preferExistingConnection?: boolean
  storageId?: string
  rootPath?: string
  wireless?: {
    /** 只表示连接准备方式，不会把密码写入应用设置。 */
    preparation?: CameraMediaSourceWirelessPreparation
    ssid?: string
    password?: string
    /** 使用提供的 Wi-Fi 凭据时，是否先自动切换系统网络。 */
    autoJoin?: boolean
  }
}

export interface CameraMediaSourceFilePage {
  pageNumber: number
  files: LunaFile[]
}

export type CameraMediaSourceFilePageCallback = (page: CameraMediaSourceFilePage) => void | Promise<void>

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
  listFiles(onPage?: CameraMediaSourceFilePageCallback): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[]): Promise<CameraDeleteResult>
  disconnect(): Promise<void>
  prepareConnection?(options?: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult>
}

export interface CameraMediaSourceApi {
  detectMounted(): Promise<MountedCameraVolume[]>
  chooseMounted(): Promise<MountedCameraVolume | null>
  connect(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult>
  check(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  listFiles(options: CameraMediaSourceOptions, onPage?: CameraMediaSourceFilePageCallback): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[], options: CameraMediaSourceOptions): Promise<CameraDeleteResult>
  disconnect(options: CameraMediaSourceOptions): Promise<void>
}

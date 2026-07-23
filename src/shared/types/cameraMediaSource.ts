import type { ConnectionStatus } from './device'
import type { CameraDeleteResult, LunaFile } from './media'

export type CameraConnectionMode = 'wireless' | 'wired'

export interface CameraMediaSourceCapabilities {
  list: boolean
  preview: boolean
  copyToLocal: boolean
  create: boolean
  update: boolean
  delete: boolean
  watch: boolean
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
}

export interface CameraMediaSourceStatus extends ConnectionStatus {
  mode: CameraConnectionMode
  connected: boolean
  sourceId: string
  rootPath?: string
  volumeLabel?: string
  capabilities: CameraMediaSourceCapabilities
}

export interface CameraMediaSourceApi {
  detectMounted(): Promise<MountedCameraVolume[]>
  chooseMounted(): Promise<MountedCameraVolume | null>
  connect(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  check(options: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus>
  listFiles(options: CameraMediaSourceOptions): Promise<LunaFile[]>
  deleteFiles(files: LunaFile[], options: CameraMediaSourceOptions): Promise<CameraDeleteResult>
  disconnect(options: CameraMediaSourceOptions): Promise<void>
}

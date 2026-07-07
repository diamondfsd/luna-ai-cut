import type { WatermarkSettings } from './watermark'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AppSettings {
  downloadDir: string
  localResourcesDir?: string
  exportDir?: string
  cacheDir: string
  cameraHost: string
  activeDeviceId?: string
  deviceStorage?: Record<string, string>
  deviceWatermark?: Record<string, WatermarkSettings>
  developerMode?: boolean
  mockMediaDir?: string
  mockHost?: string
  mockHttpPort?: number
  mockTcpPort?: number
  mockRateMbps?: number
  exportAppleLivePhoto?: boolean
  aiConfig?: AiConfig
  /** 扩展 LUT 滤镜目录路径（.cube 文件目录树，按文件夹分组） */
  lutDir?: string
}

export interface CacheStats {
  dir: string
  files: number
  bytes: number
}

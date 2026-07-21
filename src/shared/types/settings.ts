import type { WatermarkSettings } from './watermark'

export type WorkspacePreviewQuality = 'smooth' | 'balanced' | 'high' | 'original'

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
  /** 工作台最近一次导入本地文件时使用的目录 */
  workspaceImportDir?: string
  /** 扩展 LUT 滤镜目录路径（.cube 文件目录树，按文件夹分组） */
  lutDir?: string
  /** 工作台预览清晰度；原图档仍限制为最大 4K。 */
  workspacePreviewQuality?: WorkspacePreviewQuality
}

export interface CacheStats {
  dir: string
  files: number
  bytes: number
}

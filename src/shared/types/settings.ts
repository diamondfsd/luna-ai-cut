import type { CustomWatermarkAsset, WatermarkPosition, WatermarkSettings } from './watermark'
import type { CameraConnectionMode } from './cameraMediaSource'
import type { MockServerConfig } from './mock'

export type WorkspacePreviewQuality = 'smooth' | 'balanced' | 'high' | 'original'
export type CameraPreviewQuality = 'proxy' | 'original'

export type WindowCloseBehavior = 'quit' | 'hide'

export interface CustomLutFile {
  filePath: string
  fileName: string
  relativeDirectory: string
}

export interface AppSettings {
  baseDir: string
  localResourcesDir?: string
  exportDir?: string
  cacheDir: string
  cameraHost: string
  cameraConnectionMode?: CameraConnectionMode
  mountedCameraRoot?: string
  activeDeviceId?: string
  djiInstallIdentity?: string
  deviceStorage?: Record<string, string>
  deviceWatermark?: Record<string, WatermarkSettings>
  developerMode?: boolean
  mockMediaDir?: string
  mockHost?: string
  mockHttpPort?: number
  mockTcpPort?: number
  mockRateMbps?: number
  /** 按设备保存的模拟服务配置。旧字段仅作为迁移兼容回退。 */
  mockServers?: Record<string, MockServerConfig>
  /** 新素材与重置素材使用的默认水印开关。 */
  defaultWatermarkEnabled?: boolean
  /** 新素材与重置素材使用的默认水印位置。 */
  defaultWatermarkPosition?: WatermarkPosition
  /** 批量导出最近一次有效的水印设置。 */
  recentWatermarkSettings?: WatermarkSettings
  /** 用户已导入的自定义水印库，按最近导入顺序排列。 */
  customWatermarkAssets?: CustomWatermarkAsset[]
  /** 工作台最近一次导入本地文件时使用的目录 */
  workspaceImportDir?: string
  /** 扩展 LUT 滤镜目录路径（.cube 文件目录树，按文件夹分组） */
  lutDir?: string
  /** 工作台预览清晰度；原图档仍限制为最大 4K。 */
  workspacePreviewQuality?: WorkspacePreviewQuality
  /** 相机媒体预览最近一次选择的画质。 */
  cameraPreviewQuality?: CameraPreviewQuality
  /** Chromium WebGPU 视频预览实验；仅覆盖基础单视频图层，其他图层继续使用 LRC。 */
  experimentalWebGpuPreview?: boolean
  /** WebGPU + WebCodecs 导出实验；当前仅保存开关状态，正式导出仍使用稳定方式。 */
  experimentalWebGpuExport?: boolean
  /** 新下载是否按拍摄日期放入 YYYY-MM-DD 子目录。 */
  organizeDownloadsByDate?: boolean
  /** 手机分享时额外公开的目录，只扫描目录本身和下一层子目录。 */
  localMediaShareDirectories?: string[]
  /** 手机分享时拖入的文件路径，应用重启后会继续尝试共享。 */
  localMediaShareFiles?: string[]
  /** 点击窗口关闭按钮时退出应用，还是只隐藏窗口。 */
  windowCloseBehavior?: WindowCloseBehavior
}

export interface CacheStats {
  dir: string
  files: number
  bytes: number
}

export interface StorageMigrationResult {
  settings: AppSettings
  targetDir: string
  movedDirectories: string[]
  oldDataRemoved: boolean
}

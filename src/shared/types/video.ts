export type VideoResolution = 'original' | '1080p' | '2k' | '4k'

export type VideoFrameRate = 'original' | '24' | '25' | '29.97' | '30' | '50' | '60' | '120'

export type VideoQuality = 'original' | 'low' | 'medium' | 'high' | 'custom'

export type VideoExportFormat = 'video' | 'google-live' | 'apple-live'

export interface VideoExportSettings {
  resolution: VideoResolution
  frameRate: VideoFrameRate
  quality: VideoQuality
  /** 单视频工作台可同时选择多种输出；其他入口保持普通视频。 */
  exportFormats: VideoExportFormat[]
  /** 混合导出计划中是否包含图片素材和视频照片标记。 */
  exportPhotos: boolean
  /** Live 图在裁剪后视频中的 3 秒片段起点。 */
  liveStartTime: number
  /** Live 图封面相对于 3 秒片段起点的时间。 */
  liveCoverTime: number
  /** 导出弹窗中二次截取的起点，相对于工作台裁剪后的素材。 */
  trimStartTime: number
  /** 导出弹窗中二次截取的终点；未设置时使用完整时长。 */
  trimEndTime?: number
  /** 自定义码率（kbps），仅 quality 为 'custom' 时生效 */
  customBitrate?: number
  /** 本地资源中的 Dolby Vision 8.4 视频专用保真导出。 */
  dolbyVision?: boolean
  /** 本地资源导出时，自动识别并还原 Luna I-Log 视频。 */
  autoRestoreILog?: boolean
}

export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  resolution: 'original',
  frameRate: 'original',
  quality: 'original',
  exportFormats: ['video'],
  exportPhotos: true,
  liveStartTime: 0,
  liveCoverTime: 1.5,
  trimStartTime: 0,
  dolbyVision: false,
}

export function lockDolbyVisionExportSettings(settings: VideoExportSettings): VideoExportSettings {
  return {
    ...settings,
    resolution: 'original',
    frameRate: 'original',
    quality: 'original',
    exportFormats: ['video'],
    exportPhotos: false,
    liveStartTime: 0,
    trimStartTime: 0,
    trimEndTime: undefined,
    customBitrate: undefined,
    dolbyVision: true,
    autoRestoreILog: false,
  }
}

export interface DolbyVisionProbeResult {
  eligible: boolean
  profile?: number
  compatibilityId?: number
  frameCount?: number
  width?: number
  height?: number
  frameRate?: string
  reason?: string
}

export interface DolbyVisionWatermarkExportRequest {
  sourcePath: string
  outputPath: string
  watermarkPath: string
  positioning: {
    anchor: 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right'
    targetWidth: number
    marginX?: number
    marginY?: number
  }
  opacity?: number
  exportTaskId: string
  exportItemId: string
}

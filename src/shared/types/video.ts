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
  /** Live 图在裁剪后视频中的 3 秒片段起点。 */
  liveStartTime: number
  /** Live 图封面相对于 3 秒片段起点的时间。 */
  liveCoverTime: number
  /** 自定义码率（kbps），仅 quality 为 'custom' 时生效 */
  customBitrate?: number
}

export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  resolution: 'original',
  frameRate: 'original',
  quality: 'original',
  exportFormats: ['video'],
  liveStartTime: 0,
  liveCoverTime: 1.5,
}

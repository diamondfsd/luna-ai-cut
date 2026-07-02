export type VideoResolution = 'original' | '1080p' | '2k' | '4k'

export type VideoFrameRate = 'original' | '24' | '25' | '29.97' | '30' | '50' | '60' | '120'

export type VideoQuality = 'original' | 'low' | 'medium' | 'high' | 'custom'

export interface VideoExportSettings {
  resolution: VideoResolution
  frameRate: VideoFrameRate
  quality: VideoQuality
  /** 自定义码率（kbps），仅 quality 为 'custom' 时生效 */
  customBitrate?: number
}

export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  resolution: '1080p',
  frameRate: 'original',
  quality: 'original',
}

export type WatermarkPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 水印样式标识符，由设备配置和多语言决定。'auto' 表示根据设备自动选择。 */
export type WatermarkStyle = 'auto' | string

export interface WatermarkSettings {
  enabled: boolean
  style: WatermarkStyle
  /** 水印宽度占传感器最长边的百分比（1-40），默认 20 */
  watermarkPercent: number
  position: WatermarkPosition
}

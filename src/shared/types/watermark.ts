export type WatermarkPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 水印样式标识符，由设备配置决定。具体值如 "luna_ultra"、"go_ultra_cn" 等。 */
export type WatermarkStyle = string

export interface WatermarkSettings {
  enabled: boolean
  style: WatermarkStyle
  position: WatermarkPosition
}

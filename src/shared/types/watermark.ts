export type WatermarkPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 水印样式标识符，由设备配置决定。具体值如 "luna_ultra"、"go_ultra_cn" 等。 */
export type WatermarkStyle = string

export interface WatermarkSettings {
  enabled: boolean
  style: WatermarkStyle
  position: WatermarkPosition
}

/**
 * luna-render-core 静态层：lrc 内部加载 imagePath 为纹理并渲染
 * dstX/dstY/dstW/dstH 均为归一化坐标 [0, 1]
 */
export interface RenderStaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

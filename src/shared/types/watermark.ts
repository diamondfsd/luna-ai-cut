export type WatermarkPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 水印样式标识符，由设备配置决定。具体值如 "luna_ultra"、"go_ultra_cn" 等。 */
export type WatermarkStyle = string

export interface CustomWatermarkAsset {
  id: string
  fileName: string
  filePath: string
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  bytes: number
  sha256: string
}

export type WatermarkPlacement =
  | {
      mode: 'preset'
      anchor: WatermarkPosition
      insetOnShortEdge: number
    }
  | {
      mode: 'free'
      centerX: number
      centerY: number
    }

export interface WatermarkSettings {
  enabled: boolean
  style: WatermarkStyle
  position: WatermarkPosition
  /** 缺省表示旧版内置水印，保证历史项目继续使用原几何。 */
  sourceKind?: 'builtin' | 'custom'
  customAsset?: CustomWatermarkAsset
  /** 水印显示宽度占可见画面宽度的比例。 */
  sizeOnCanvasWidth?: number
  /** 自定义几何；缺省时继续使用旧 position。 */
  placement?: WatermarkPlacement
  opacity?: number
  /** 以下字段由 onChange 时自动填充 */
  imagePath?: string
  imageWidth?: number
  imageHeight?: number
  widthRatio?: number
  xRatio?: number
  yRatio?: number
}

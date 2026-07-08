/**
 * luna-render-core 层类型（统一，匹配 Rust PreviewLayerInput）
 * 所有坐标均为归一化 [0, 1]
 */

/** 水印相对定位：横屏/竖屏各一套 */
export interface WatermarkPositioning {
  /** 锚点位置 */
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
  /** 宽度占输出画布比例 0-1 */
  targetWidth: number
  /** 水平边距 0-1 */
  marginX?: number
  /** 垂直边距 0-1 */
  marginY?: number
}

/** 统一层描述 — Rust 渲染层输入 */
export interface RenderCurvePoint {
  x: number
  y: number
}

export interface RenderToneCurveAdjust {
  rgb: RenderCurvePoint[]
  luminance: RenderCurvePoint[]
  red: RenderCurvePoint[]
  green: RenderCurvePoint[]
  blue: RenderCurvePoint[]
}

export interface RenderHslChannelAdjust {
  hue: number
  hueShift: number
  saturation: number
  luminance: number
}

export interface RenderColorAdjustments {
  exposure: number
  black: number
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  clarity: number
  texture: number
  sharpen: number
  denoise: number
  gradeShadowsHue: number
  gradeShadowsAmount: number
  gradeMidHue: number
  gradeMidAmount: number
  gradeHighlightsHue: number
  gradeHighlightsAmount: number
  curveLift: number
  curveContrast: number
  curve: RenderToneCurveAdjust
  levelsBlack: number
  levelsGray: number
  levelsWhite: number
  hslChannels: RenderHslChannelAdjust[]
}

export interface RenderCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderLayerTransform {
  crop: RenderCropRect | null
  orientation: number
  rotate: number
  flipH: boolean
  flipV: boolean
  scale: number
  translateX?: number
  translateY?: number
}

export interface PreviewLayer {
  filePath: string
  isVideo?: boolean
  videoTime?: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
  /** 水印相对定位：有则 Rust 自动重算 dstX/Y/W/H，纹样不变形 */
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** 3D LUT 文件路径（传给 Rust 自行加载解析） */
  lutId?: string
  /** LUT 强度 0-100 */
  lutIntensity?: number
}

export interface CompositionInput {
  version?: number
  canvas: {
    width: number
    height: number
    fps?: number
    duration?: number
  }
  layers: CompositionLayer[]
}

export interface CompositionLayer {
  id?: string
  source: {
    path: string
    sourceType?: 'auto' | 'image' | 'video' | string
    time?: {
      offset?: number
      start?: number
      duration?: number
      loopEnabled?: boolean
    }
  }
  rect: { x: number; y: number; w: number; h: number }
  fit?: 'cover' | 'contain' | string
  opacity?: number
  zIndex?: number
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** 3D LUT 文件路径 */
  lutId?: string
  /** LUT 强度 0-100 */
  lutIntensity?: number
}

/** 纹理层 */
export interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** 3D LUT 文件路径 */
  lutId?: string
  lutIntensity?: number
}

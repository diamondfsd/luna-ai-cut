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
  layerType?: 'media' | 'local-color' | 'pixel-stretch' | 'shape' | 'text' | 'logo' | 'decoration'
  filePath: string
  isVideo?: boolean
  /** 显式相同的 key 会复用同一份视频解码纹理。 */
  videoSourceKey?: string
  videoTime?: number
  /** 合成开始后延迟多少秒再推进源视频，用于首帧停留。 */
  videoOffset?: number
  /** 截取后的有效时长（秒）。不设则用源视频完整时长。 */
  videoDuration?: number
  /** 纹理在目标区域内的适配方式；cover-scale 保留完整纹理并用基础缩放填满区域 */
  fit?: 'cover' | 'cover-scale' | 'stretch'
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  blendMode?: 'normal' | 'multiply' | 'screen' | 'add'
  zIndex: number
  /** 仅导出合成使用；实时预览由调用方按播放进度更新裁剪。 */
  reveal?: CompositionReveal
  color?: RenderColorAdjustments
  maskPath?: string
  maskOpacity?: number
  maskInverted?: boolean
  maskFeather?: number
  pixelStretch?: RenderPixelStretch
  transform?: RenderLayerTransform
  /** 水印相对定位：有则 Rust 自动重算 dstX/Y/W/H，纹样不变形 */
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** i-Log 技术还原 LUT 文件路径 */
  restoreLutId?: string
  /** 创意 3D LUT 文件路径（传给 Rust 自行加载解析） */
  lutId?: string
  /** LUT 强度 0-100 */
  lutIntensity?: number
  shape?: 'rectangle' | 'rounded-rectangle' | 'line' | 'circle'
  fillColor?: string
  cornerRadius?: number
  strokeColor?: string
  strokeWidth?: number
  content?: string
  fontSize?: number
  fontFamily?: string
  fontFile?: string
  fontWeight?: number
  textColor?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
}

export interface RenderPixelStretch {
  mode: 'left' | 'right' | 'up' | 'down' | 'horizontal' | 'vertical' | 'swirl' | 'swirl-front'
  intensity: number
  originX: number
  originY: number
  angle?: number
  ribbonSize?: number
  sampleStart?: number
  sampleEnd?: number
  lineEnd?: number
  controlStart?: number
  controlEnd?: number
  centerX?: number
  centerY?: number
  pathPoints?: number[]
  pathStartWidth?: number
  pathEndWidth?: number
  /** 用邻近的主体颜色补齐取样线中的空隙，生成连续色带。 */
  fillSampleGaps?: boolean
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

export interface CompositionReveal {
  direction: 'left-to-right'
  start: number
  /** 实际运动时长，不包含中段停顿。 */
  duration: number
  midpointHold?: number
  /** 到达中点后回退的画面宽度比例。 */
  midpointBounce?: number
  easing?: 'linear' | 'ease-in-out'
}

export interface CompositionLayer {
  layerType?: 'media' | 'local-color' | 'pixel-stretch' | 'shape' | 'text' | 'logo' | 'decoration'
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
  /** 从源纹理采样的归一化区域；省略时使用完整源图。 */
  sourceRect?: { x: number; y: number; w: number; h: number }
  fit?: 'cover' | 'contain' | 'stretch' | string
  opacity?: number
  blendMode?: 'normal' | 'multiply' | 'screen' | 'add'
  zIndex?: number
  /** 按合成时间从左向右展开当前图层。 */
  reveal?: CompositionReveal
  color?: RenderColorAdjustments
  maskPath?: string
  maskOpacity?: number
  maskInverted?: boolean
  maskFeather?: number
  pixelStretch?: RenderPixelStretch
  transform?: RenderLayerTransform
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** i-Log 技术还原 LUT 文件路径 */
  restoreLutId?: string
  /** 创意 3D LUT 文件路径 */
  lutId?: string
  /** LUT 强度 0-100 */
  lutIntensity?: number
  shape?: 'rectangle' | 'rounded-rectangle' | 'line' | 'circle'
  fillColor?: string
  cornerRadius?: number
  strokeColor?: string
  strokeWidth?: number
  content?: string
  fontSize?: number
  fontFamily?: string
  fontFile?: string
  fontWeight?: number
  textColor?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
}

/** 纹理层 */
export interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  blendMode?: 'normal' | 'multiply' | 'screen' | 'add'
  color?: RenderColorAdjustments
  maskPath?: string
  maskOpacity?: number
  maskInverted?: boolean
  maskFeather?: number
  transform?: RenderLayerTransform
  positioning?: WatermarkPositioning | { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning }
  /** i-Log 技术还原 LUT 文件路径 */
  restoreLutId?: string
  /** 创意 3D LUT 文件路径 */
  lutId?: string
  lutIntensity?: number
}

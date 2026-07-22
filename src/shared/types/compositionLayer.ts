export interface LayerRect { x: number; y: number; w: number; h: number }

export interface BaseCompositionLayer {
  id: string
  type: 'media' | 'shape' | 'text' | 'logo' | 'decoration' | 'group'
  rect: LayerRect
  opacity?: number
  zIndex: number
  visible?: boolean
  parentId?: string
  groupId?: string
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay'
}

export interface ShapeLayer extends BaseCompositionLayer {
  type: 'shape'
  shape: 'rectangle' | 'rounded-rectangle' | 'line' | 'circle'
  fill?: { type: 'solid'; color: string }
  cornerRadius?: number
  /** 从形状外缘向内连续过渡到设定透明度，使用归一化局部坐标。 */
  feather?: number
  stroke?: { width: number; color: string; opacity?: number }
}

export interface TextLayer extends BaseCompositionLayer {
  type: 'text'
  content: string
  template?: boolean
  style: {
    fontFamily: string
    fontFile?: string
    fontSize: number
    fontWeight?: number
    color: string
    align?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'middle' | 'bottom'
    letterSpacing?: number
  }
  overflow?: 'clip' | 'ellipsis' | 'shrink'
}

export interface LogoLayer extends BaseCompositionLayer {
  type: 'logo'
  source?: { path?: string; dataBase64?: string; format?: 'png' | 'svg' }
  fallbackText?: string
  tint?: { color: string; opacity?: number }
  fit?: 'contain' | 'cover'
}

export interface MediaCompositionLayer extends BaseCompositionLayer {
  type: 'media'
  source: { path: string; sourceType?: 'auto' | 'image' | 'video' }
  crop?: LayerRect
  fit?: 'contain' | 'cover' | 'stretch' | 'cover-scale'
  /** 仅用于创意版式背景，单位为源纹理像素。 */
  blurRadius?: number
  cornerRadius?: number
}

export interface DecorationLayer extends BaseCompositionLayer {
  type: 'decoration'
  decorationType: 'film-holes' | 'divider' | 'corner-mark' | 'frame-number' | 'texture' | 'custom-image'
  color?: string
}

export interface GroupLayer extends BaseCompositionLayer {
  type: 'group'
  name?: string
  metadata?: { presetId?: string; presetName?: string; presetCategory?: string }
}

export type DeclarativeCompositionLayer = ShapeLayer | TextLayer | LogoLayer | MediaCompositionLayer | DecorationLayer | GroupLayer

export interface FramePresetDefaultSettings {
  frameSize?: number
  backgroundColor?: string
  textColor?: string
  opacity?: number
  showLogo?: boolean
  showTitle?: boolean
  showCameraInfo?: boolean
  showDate?: boolean
  title?: string
  mediaScale?: number
  mediaOffsetX?: number
  mediaOffsetY?: number
  shadowStrength?: number
  shadowBlur?: number
  shadowOffsetY?: number
}

export interface FramePreset {
  id: string
  name: string
  category: 'minimal' | 'film' | 'blur' | 'gallery' | 'polaroid' | 'magazine'
  description?: string
  /** 兼容旧预设；新预设应使用 defaultSettings.title。 */
  defaultTitle?: string
  defaultSettings?: FramePresetDefaultSettings
  swatch: string
  layers: DeclarativeCompositionLayer[]
}

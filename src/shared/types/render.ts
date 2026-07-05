/**
 * luna-render-core 层类型（统一，匹配 Rust PreviewLayerInput）
 * 所有坐标均为归一化 [0, 1]
 */

/** 统一层描述 — Rust 渲染层输入 */
export interface RenderColorAdjustments {
  exposure: number
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
}

export interface PreviewLayer {
  filePath: string
  isVideo?: boolean
  videoTime?: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
  /** 前端适配方式，Rust 不感知 */
  fit?: 'fill' | 'contain'
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
}

/** 纹理层（需先通过 lrc.loadTexture 加载） */
export interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
}

/** 静态层（lrc 内部加载 imagePath 为纹理并渲染，兼容 PreviewLayer） */
export interface StaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
  color?: RenderColorAdjustments
  transform?: RenderLayerTransform
}

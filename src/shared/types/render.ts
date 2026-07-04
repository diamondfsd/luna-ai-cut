/**
 * luna-render-core 渲染层通用类型
 * dstX/dstY/dstW/dstH 均为归一化坐标 [0, 1]
 */

/** 纹理层（需先通过 lrc.loadTexture 加载） */
export interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

/** 静态层（lrc 内部加载 imagePath 为纹理并渲染） */
export interface StaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

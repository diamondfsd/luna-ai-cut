/**
 * Watermark Demo — 核心类型定义
 *
 * 遵循 PLAN.md 的架构模型：
 *   Project → Timeline → Layout → SceneGraph → Compositor
 *
 * 预览和导出共用同一套数据结构和 renderFrame()。
 */

// ── Project Model（用户想要什么，不描述怎么渲染） ──

export interface OutputConfig {
  width: number
  height: number
  background: string // CSS color
}

export interface MediaAsset {
  id: string
  type: 'image' | 'video'
  /** 本地文件路径或 data URL */
  source: string
  width: number
  height: number
  duration?: number // 视频时长（秒）
  name: string
}

export type WatermarkPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type WatermarkType = 'text' | 'image'

export interface TextWatermarkConfig {
  type: 'text'
  text: string
  fontSize: number   // 相对于画布宽度的比例（0-1），最终像素 = fontSize * canvasWidth
  color: string      // CSS color
  opacity: number    // 0-1
  fontFamily: string
}

export interface ImageWatermarkConfig {
  type: 'image'
  /** data URL 或 blob URL */
  imageSrc: string
  /** 水印占画布宽度的比例 */
  widthRatio: number // 0-1，最终像素 = widthRatio * canvasWidth
  opacity: number
}

export type WatermarkConfig = TextWatermarkConfig | ImageWatermarkConfig

export interface WatermarkLayer {
  enabled: boolean
  config: WatermarkConfig
  position: WatermarkPosition
  /** 水印边距（占画布宽度的比例） */
  marginRatio: number
}

// ── Timeline ──

export interface Clip {
  id: string
  assetId: string
  transform: {
    /** 目标区域（相对于画布的归一化坐标 0-1） */
    x: number
    y: number
    width: number
    height: number
    /** 旋转角度（度） */
    rotation: number
    /** 缩放 */
    scale: number
    /** 透明度 */
    opacity: number
    /** 图片适配模式 */
    fit: 'cover' | 'contain' | 'fill'
  }
}

export interface Track {
  id: string
  type: 'media' | 'watermark'
  clips: Clip[]
}

export interface Timeline {
  tracks: Track[]
}

export interface Project {
  version: number
  output: OutputConfig
  assets: MediaAsset[]
  timeline: Timeline
  watermark: WatermarkLayer
}

// ── Layout Engine 输出 ──

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ResolvedLayer {
  layerId: string
  type: 'media' | 'watermark'
  /** 源素材裁剪区域（像素坐标） */
  srcRect: Rect
  /** 目标绘制区域（像素坐标） */
  dstRect: Rect
  /** 透明度 */
  opacity: number
  /** 旋转角度（弧度） */
  rotation: number
  /** 层级 */
  zIndex: number
}

// ── Scene Graph（某个时间点的最终渲染结构） ──

export interface TextLayerData {
  kind: 'text'
  text: string
  fontSize: number
  color: string
  fontFamily: string
}

export interface ImageLayerData {
  kind: 'image'
  /** Image 元素引用或 src */
  image: HTMLImageElement | HTMLVideoElement
}

export type LayerData = TextLayerData | ImageLayerData

export interface SceneLayer {
  layerId: string
  data: LayerData
  layout: ResolvedLayer
}

export interface SceneGraph {
  canvas: {
    width: number
    height: number
    background: string
  }
  layers: SceneLayer[]
}

// ── Compositor ──

export type RenderQuality = 'preview' | 'export'

export interface RenderOptions {
  width: number
  height: number
  quality: RenderQuality
  /** 导出时的输出格式 */
  format?: 'image/png' | 'image/jpeg'
  /** JPEG 质量 (0-1) */
  jpegQuality?: number
}

export interface RenderedFrame {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

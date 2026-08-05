import type { EditPipeline } from './editPipeline'
import type { AutomaticSegmentationTargetId } from '../../shared/segmentationModels'

export type ColorMaskBlendMode = 'normal' | 'multiply' | 'screen' | 'add'
export type ColorMaskComponentOperation = 'replace' | 'add' | 'subtract' | 'intersect'

interface ColorMaskComponentBase {
  id: string
  loadError?: 'missing-or-damaged'
  operation: ColorMaskComponentOperation
  enabled: boolean
  inverted: boolean
  targetComponentId?: string
}

export interface ColorMaskSegmentationSource {
  kind: 'segmentation'
  /** 实际执行推理的模型；用于在其他视频帧重新生成该组件。 */
  modelId: string
  /** 视频取帧时间；图片蒙版不保存。 */
  frameTime?: number
  targetId?: string
  classId?: number
  className?: string
  /** SAM 等点提示模型使用的归一化素材坐标。 */
  point?: { x: number; y: number }
}

export type ColorMaskDynamicSource = ColorMaskSegmentationSource

export interface ColorMaskRasterComponent extends ColorMaskComponentBase {
  type: 'raster'
  path: string
  width: number
  height: number
  dynamicSource?: ColorMaskDynamicSource
}

export interface ColorMaskShapeComponent extends ColorMaskComponentBase {
  type: 'rectangle' | 'ellipse' | 'radial-gradient'
  /** 素材像素宽高比；不能使用可能为方形的模型/蒙版缓存尺寸代替。 */
  sourceAspect?: number
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
  /** 旧项目的统一外扩比例。 */
  feather: number
  /** Power Window 柔化比例；以中间轮廓为 50%，同时向内、向外扩展。 */
  softness?: number
  /** 旧版外圈横向、纵向扩展，仅用于项目迁移。 */
  featherX?: number
  featherY?: number
}

export interface ColorMaskLinearGradientComponent extends ColorMaskComponentBase {
  type: 'linear-gradient'
  startX: number
  startY: number
  endX: number
  endY: number
}

export type ColorMaskComponent = ColorMaskRasterComponent | ColorMaskShapeComponent | ColorMaskLinearGradientComponent

export interface ColorMaskTrackKeyframe {
  time: number
  translateX: number
  translateY: number
  scale: number
  rotation: number
  confidence: number
  corrected?: boolean
}

export interface ColorMaskTrack {
  version: 1
  algorithmVersion?: 2
  anchorTime: number
  startTime: number
  endTime: number
  keyframes: ColorMaskTrackKeyframe[]
}

export interface ColorMaskTimelineFrame {
  time: number
  /** 缺少路径表示该采样区间没有可用人物蒙版。 */
  path?: string
  /** 由相邻视频帧的光流跟踪得到，作用于当前路径对应的蒙版。 */
  transform?: {
    translateX: number
    translateY: number
    scale: number
    rotation: number
    confidence: number
  }
}

export interface ColorMaskTimeline {
  version: 1
  startTime: number
  endTime: number
  sampleInterval: number
  frames: ColorMaskTimelineFrame[]
}

export interface ColorMaskRef {
  path: string
  width: number
  height: number
  opacity: number
  inverted: boolean
  feather: number
  kind: 'brush' | 'semantic'
  classId?: number
  className?: string
  targetId?: AutomaticSegmentationTargetId
  modelId?: string
}

export interface ColorMaskLayer extends ColorMaskRef {
  id: string
  name: string
  enabled: boolean
  loadError?: 'missing-or-damaged'
  blendMode: ColorMaskBlendMode
  color: EditPipeline['color']
  componentSchemaVersion?: 1
  components?: ColorMaskComponent[]
  track?: ColorMaskTrack
  timeline?: ColorMaskTimeline
}

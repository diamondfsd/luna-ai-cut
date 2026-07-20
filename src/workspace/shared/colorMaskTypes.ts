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

export interface ColorMaskRasterComponent extends ColorMaskComponentBase {
  type: 'raster'
  path: string
  width: number
  height: number
}

export interface ColorMaskShapeComponent extends ColorMaskComponentBase {
  type: 'rectangle' | 'ellipse' | 'radial-gradient'
  centerX: number
  centerY: number
  width: number
  height: number
  rotation: number
  feather: number
}

export interface ColorMaskLinearGradientComponent extends ColorMaskComponentBase {
  type: 'linear-gradient'
  startX: number
  startY: number
  endX: number
  endY: number
}

export type ColorMaskComponent = ColorMaskRasterComponent | ColorMaskShapeComponent | ColorMaskLinearGradientComponent

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
}

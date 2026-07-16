import type { EditPipeline } from './editPipeline'
import type { AutomaticSegmentationTargetId } from '../../shared/segmentationModels'

export type ColorMaskBlendMode = 'normal' | 'multiply' | 'screen' | 'add'

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
}

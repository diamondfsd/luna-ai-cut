import type { EditPipeline } from './editPipeline'

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

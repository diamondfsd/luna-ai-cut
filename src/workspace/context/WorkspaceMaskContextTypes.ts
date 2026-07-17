import type { AutomaticSegmentationTargetId, SegmentationModelId } from '../../shared/segmentationModels'
import type { WorkspaceSegmentationProgress } from '../../shared/types/api'
import type { ColorMaskLayer } from '../shared/editPipeline'
import type { MaskSelectionOperation } from '../mask/maskSelectionOperations'

export interface SegmentationPerformance {
  modelLoadMs: number
  imagePrepareMs: number
  inferenceMs: number
  totalMs: number
}

export interface WorkspaceMaskValue {
  available: boolean
  editing: boolean
  setEditing: (value: boolean) => void
  selectionOperation: MaskSelectionOperation
  setSelectionOperation: (value: MaskSelectionOperation) => void
  brushActive: boolean
  setBrushActive: (value: boolean) => void
  brushSize: number
  setBrushSize: (value: number) => void
  showOverlay: boolean
  setShowOverlay: (value: boolean) => void
  maskData: Uint8Array | null
  maskSize: { width: number; height: number } | null
  busy: boolean
  semanticPicking: boolean
  setSemanticPicking: (value: boolean) => void
  segmentationModel: SegmentationModelId
  setSegmentationModel: (value: SegmentationModelId) => void
  lastSegmentationPerformance: SegmentationPerformance | null
  segmentationProgress: WorkspaceSegmentationProgress | null
  segmentationError: string | null
  clearSegmentationError: () => void
  cancelSegmentation: () => void
  activeLayerId: string | null
  activeMask: ColorMaskLayer | null
  setActiveLayerId: (id: string | null) => void
  createMask: () => void
  updateLayer: (id: string, patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'inverted' | 'blendMode' | 'color'>>) => void
  updateActiveLayer: (patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => void
  duplicateLayer: (id: string) => void
  removeLayer: (id: string) => void
  moveLayer: (id: string, direction: -1 | 1) => void
  moveActiveLayer: (direction: -1 | 1) => void
  commitMask: (data: Uint8Array) => Promise<void>
  updateMaskSettings: (patch: { opacity?: number; inverted?: boolean; feather?: number }) => void
  updateGroupedMaskSettings: (patch: { opacity?: number; feather?: number }, groupKey: string, finalize?: boolean) => void
  removeMask: () => Promise<void>
  generateSemanticMask: (point?: { x: number; y: number }, targetId?: AutomaticSegmentationTargetId, modelId?: SegmentationModelId) => Promise<void>
}

export interface WorkspaceMediaAsset {
  id: string
  name: string
  path: string
  kind: 'image' | 'video'
  thumbnailUrl?: string | null
  isLivePhoto?: boolean
}

export interface WorkspaceColorMetadata {
  whiteBalanceMode: 'auto' | 'manual' | 'unknown'
  temperatureKelvin: number | null
  tint: number | null
}

export interface WorkspaceProjectAsset extends WorkspaceMediaAsset {
  pipeline?: unknown
  removal?: WorkspaceRemovalPipeline
}

export interface WorkspaceRemovalOperation {
  id: string
  enabled: boolean
  maskPath: string
  maskWidth: number
  maskHeight: number
  resultPath: string
  inputRevision: string
  edgeExpansion: number
  feather: number
  model: { id: 'big-lama-fp32'; version: 'carve-c3c0c9e'; sha256: string }
  createdAt: string
}

export interface WorkspaceRemovalPipeline {
  schemaVersion: 1
  operations: WorkspaceRemovalOperation[]
}

export interface WorkspaceTripleStitchState {
  selectedIds: string[]
  activeSlot: number
  slotEdits: Array<{
    scale: number
    translateX: number
    translateY: number
    startTime: number
  }>
  watermarkStyle: string
}

export interface WorkspaceColorRevealState {
  saturation: number
  gray: number
  /** 兼容旧版灰片反差配置。 */
  contrast?: number
  transitionDuration: number
  initialHoldDuration?: number
  midpointHoldDuration?: number
  stageMode?: 'two' | 'three'
}

export type PixelStretchPresetId = 'left' | 'right' | 'top' | 'bottom' | 'horizontal' | 'vertical'
export type PixelStretchSubjectModel = 'fast' | 'precise'
export type PixelStretchFlowShape = 'straight' | 'arc' | 'cape' | 's-curve' | 'custom'

export interface PixelStretchPathPoint {
  x: number
  y: number
}

export interface WorkspacePixelStretchState {
  preset: PixelStretchPresetId
  subjectModel?: PixelStretchSubjectModel
  intensity: number
  angle: number
  samplePosition: number
  sampleEndPosition: number
  sampleLocked: boolean
  ribbonSize: number
  sampleRangeStart?: number
  sampleRangeEnd?: number
  sampleControlStartOffset?: number
  sampleControlEndOffset?: number
  flowShape?: PixelStretchFlowShape
  flowLength?: number
  flowCurve?: number
  flowWidth?: number
  flowEndWidth?: number
  flowPoints?: PixelStretchPathPoint[]
  maskPath?: string
  maskAssetId?: string
}

export interface WorkspaceProject {
  id: string
  name: string
  dir: string
  createdAt: string
  updatedAt: string
  assets: WorkspaceProjectAsset[]
  creative?: {
    tripleStitch?: WorkspaceTripleStitchState
    colorReveal?: WorkspaceColorRevealState
    pixelStretch?: WorkspacePixelStretchState
    pixelStretchByAssetId?: Record<string, WorkspacePixelStretchState>
  }
}

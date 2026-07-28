export interface WorkspaceMediaAsset {
  id: string
  name: string
  path: string
  kind: 'image' | 'video'
  thumbnailUrl?: string | null
  isLivePhoto?: boolean
}

export type WorkspaceMediaKind = WorkspaceMediaAsset['kind']

export interface WorkspaceVideoSegmentsExport {
  sourcePath: string
  segments: Array<{
    note: string
    startTime: number
    endTime: number
  }>
}

export interface WorkspaceColorMetadata {
  whiteBalanceMode: 'auto' | 'manual' | 'unknown'
  temperatureKelvin: number | null
  tint: number | null
}

export interface WorkspaceProjectAsset extends WorkspaceMediaAsset {
  pipeline?: unknown
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

export interface WorkspaceOnlyYourColorState {
  intensity: number
  subjectExposure?: number
  backgroundExposure?: number
  backgroundBrightness?: number
  backgroundContrast?: number
  subjectSaturation?: number
  subjectVibrance?: number
  subjectModel?: PixelStretchSubjectModel
  maskPath?: string
  maskAssetId?: string
}

export interface WorkspacePixelFlowState {
  settingsVersion?: number
  duration: number
  pixelCount: number
  lightWidth: number
  initialSaturation: number
  initialBrightness: number
  rainSpeed: number
  rainLength: number
  flowStrength: number
  subjectDelay: number
  bloomStrength: number
  filterStrength: number
  colorTransition: number
  maskPath?: string
  skyMaskPath?: string
  depthMaskPath?: string
  maskAssetId?: string
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
    pixelFlow?: WorkspacePixelFlowState
    pixelFlowByAssetId?: Record<string, WorkspacePixelFlowState>
    tripleStitch?: WorkspaceTripleStitchState
    colorReveal?: WorkspaceColorRevealState
    onlyYourColor?: WorkspaceOnlyYourColorState
    onlyYourColorByAssetId?: Record<string, WorkspaceOnlyYourColorState>
    pixelStretch?: WorkspacePixelStretchState
    pixelStretchByAssetId?: Record<string, WorkspacePixelStretchState>
  }
}

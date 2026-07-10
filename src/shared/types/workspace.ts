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

export interface WorkspaceProject {
  id: string
  name: string
  dir: string
  createdAt: string
  updatedAt: string
  assets: WorkspaceProjectAsset[]
  creative?: {
    tripleStitch?: WorkspaceTripleStitchState
  }
}

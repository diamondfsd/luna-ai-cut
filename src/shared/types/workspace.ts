export interface WorkspaceMediaAsset {
  id: string
  name: string
  path: string
  kind: 'image' | 'video'
  thumbnailUrl?: string | null
}

export interface WorkspaceColorMetadata {
  whiteBalanceMode: 'auto' | 'manual' | 'unknown'
  temperatureKelvin: number | null
  tint: number | null
}

export interface WorkspaceProjectAsset extends WorkspaceMediaAsset {
  pipeline?: unknown
}

export interface WorkspaceProject {
  id: string
  name: string
  dir: string
  createdAt: string
  updatedAt: string
  assets: WorkspaceProjectAsset[]
}

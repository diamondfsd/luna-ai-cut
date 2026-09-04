export type ReferenceMatchMethod = 'reinhard' | 'kantorovich' | 'forgy' | 'wasserstein'

export interface WorkspaceReferenceMatchLutRequest {
  cube: string
  name: string
  description?: string
  method: ReferenceMatchMethod
  referenceAssetId: string
  referenceName: string
  targetAssetId: string
  targetName: string
}

export interface WorkspaceReferenceMatchLutResult {
  path: string
  name: string
  category: string
}

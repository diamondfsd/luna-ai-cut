export type ReferenceMatchMethod = 'neural-preset' | 'reinhard' | 'kantorovich' | 'forgy' | 'wasserstein'
export type ReferenceMatchResultKind = 'image' | 'lut'

export interface ReferenceMatchSettings {
  enabled: boolean
  method: ReferenceMatchMethod
  strength: number
  referenceAssetId: string
  referenceName: string
  targetAssetId: string
  targetName: string
  resultPath: string
  resultKind: ReferenceMatchResultKind
  generatedAt: string
  modelVersion?: string
}

export interface WorkspaceReferenceMatchLutRequest {
  projectId: string
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

export interface WorkspaceReferenceMatchAiLutRequest {
  projectId: string
  targetPath: string
  referencePath: string
  referenceName: string
  targetName: string
  referenceAssetId: string
  targetAssetId: string
}

export interface WorkspaceReferenceMatchAiLutResult {
  path: string
  name: string
  category: string
  modelVersion: string
}

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

export interface WorkspaceReferenceMatchImageRequest {
  targetPath: string
  referencePath: string
  targetWidth: number
  targetHeight: number
  referenceName: string
  targetName: string
  referenceAssetId: string
  targetAssetId: string
}

export interface WorkspaceReferenceMatchImageResult {
  path: string
  width: number
  height: number
  modelVersion: string
}

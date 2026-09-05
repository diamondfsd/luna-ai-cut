export type ReferenceMatchMethod = 'neural-preset' | 'reinhard' | 'kantorovich' | 'forgy' | 'wasserstein'
export type ReferenceMatchResultKind = 'image' | 'lut'

export interface ReferenceMatchSettings {
  enabled: boolean
  method: ReferenceMatchMethod
  strength: number
  referenceAssetId: string
  referenceName: string
  /** 参考图在生成结果时的本地路径；重新粘贴时优先按素材 ID 解析最新路径。 */
  referencePath?: string
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

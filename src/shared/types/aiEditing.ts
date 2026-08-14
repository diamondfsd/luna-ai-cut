export type WorkspaceVisualAnalysisIntensity = 'light' | 'normal' | 'strong'

export interface WorkspaceVisualAnalysisRequest {
  requestId: string
  filePath: string
  durationSeconds: number
  intensity?: WorkspaceVisualAnalysisIntensity
}

export interface WorkspaceVisualEvidenceSample {
  timeSeconds: number
  tags: string[]
}

export interface WorkspaceVisualAnalysisResult {
  requestId: string
  samples: WorkspaceVisualEvidenceSample[]
  models: Array<{ id: string; version: string }>
  sourceFingerprint: { size: number; modifiedAtMs: number }
  intensity: WorkspaceVisualAnalysisIntensity
}

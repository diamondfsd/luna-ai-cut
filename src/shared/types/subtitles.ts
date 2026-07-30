export type WorkspaceSubtitleLanguage = 'auto' | 'zh' | 'en'

export interface WorkspaceSubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
  source: 'generated' | 'edited'
}

export interface WorkspaceSubtitleTrack {
  schemaVersion: 1
  enabled: boolean
  language: string
  model: { id: string; version: string; sha256: string }
  sourceRange: { startMs: number; endMs: number }
  sourceFingerprint: { size: number; modifiedAtMs: number }
  cues: WorkspaceSubtitleCue[]
  generatedAt: string
}

export interface WorkspaceSubtitleTranscriptionRequest {
  requestId: string
  filePath: string
  startMs: number
  endMs: number
  language: WorkspaceSubtitleLanguage
}

export interface WorkspaceSubtitleTranscriptionResult {
  requestId: string
  language: string
  cues: WorkspaceSubtitleCue[]
  model: { id: string; version: string; sha256: string }
  sourceFingerprint: { size: number; modifiedAtMs: number }
  performance: {
    modelLoadMs: number
    inferenceMs: number
    audioMs: number
    totalMs: number
  }
}

export interface WorkspaceSubtitleProgress {
  requestId: string
  phase: 'model' | 'preparing' | 'recognizing'
  label: string
  percent: number | null
}

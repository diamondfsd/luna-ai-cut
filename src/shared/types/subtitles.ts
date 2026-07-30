export type WorkspaceSubtitleLanguage = 'auto' | 'zh' | 'en'

export interface WorkspaceSubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
  source: 'generated' | 'edited'
}

export interface WorkspaceSubtitleFontAsset {
  fileName: string
  filePath: string
  format: 'otf' | 'ttf'
}

export interface WorkspaceSubtitleStyle {
  fontSize: number
  fontWeight: 200 | 300 | 350 | 400 | 500 | 700 | 900
  fontFamily: string
  fontFile: string
  customFont?: WorkspaceSubtitleFontAsset
  textColor: string
  backgroundColor: string
  backgroundOpacity: number
  borderColor: string
  borderWidth: number
  cornerRadius: number
  width: number
  positionY: number
}

export interface WorkspaceSubtitleTrack {
  schemaVersion: 1
  enabled: boolean
  language: string
  model: { id: string; version: string; sha256: string }
  sourceRange: { startMs: number; endMs: number }
  sourceFingerprint: { size: number; modifiedAtMs: number }
  cues: WorkspaceSubtitleCue[]
  style?: WorkspaceSubtitleStyle
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

export interface WorkspaceVisualAnalysisRequest {
  requestId: string
  filePath: string
  durationSeconds: number
  /** Upper bound protects foreground analysis from a very long source. */
  maxSamples?: number
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
}

/** Public connection state. The API Key stays in Electron's secure storage. */
export interface AiEditingAssistantConfig {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface AiEditingAssistantConfigInput {
  baseUrl: string
  model: string
  /** Supplying a key replaces it; omitting it preserves the stored key. */
  apiKey?: string
  clearApiKey?: boolean
}

export interface AiEditingAssistantGenerateInput {
  requestId: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  maxTokens: number
  temperature: number
}

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

/** Public connection state. The API Key is kept in the app's local configuration file. */
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

export interface AiEditingAssistantToolDefinition {
  /** Function name accepted by Chat Completions. */
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export interface AiEditingAssistantToolCall {
  id: string
  name: string
  /** JSON encoded arguments returned by the model. */
  arguments: string
}

export type AiEditingAssistantMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: AiEditingAssistantToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface AiEditingAssistantGenerateInput {
  requestId: string
  messages: AiEditingAssistantMessage[]
  /** Prefer native tool calling and automatically use the JSON protocol when unavailable. */
  mode?: 'auto' | 'json'
  tools?: AiEditingAssistantToolDefinition[]
  maxTokens: number
  temperature: number
  reasoningEffort: 'low' | 'high' | 'xhigh' | 'max'
}

export interface AiEditingAssistantGenerateResult {
  /** `fallback` asks the renderer to restart this turn with the JSON compatibility protocol. */
  mode: 'tools' | 'json' | 'fallback'
  content: string
  toolCalls: AiEditingAssistantToolCall[]
}

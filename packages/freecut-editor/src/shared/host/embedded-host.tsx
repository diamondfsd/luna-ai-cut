import { createContext, useContext, useEffect, type ReactNode } from 'react'

export type ImportMediaFiles = (files: File[]) => Promise<void>

/**
 * Identity supplied to an embedded host without exposing its local path or
 * source bytes. The host can resolve this against the files it imported.
 */
export interface EmbeddedMediaSource {
  mediaId: string
  fileName: string
  fileSize: number
  fileLastModified?: number
  mimeType: string
  durationSeconds: number
}

export interface EmbeddedTranscriptResult {
  language: string
  cues: Array<{ startSeconds: number; endSeconds: number; text: string }>
  model: { id: string; version: string }
  sourceFingerprint: { size: number; modifiedAtMs: number }
}

export interface EmbeddedVisualEvidence {
  samples: Array<{ timeSeconds: number; tags: string[] }>
  models: Array<{ id: string; version: string }>
  sourceFingerprint: { size: number; modifiedAtMs: number }
}

export interface EmbeddedTaskProgress {
  label: string
  percent: number | null
}

export interface EmbeddedAiAssistantConfig {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface EmbeddedAiAssistantConfigInput {
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface EmbeddedAiAssistantToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export interface EmbeddedAiAssistantToolCall {
  id: string
  name: string
  arguments: string
}

export type EmbeddedAiAssistantMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: EmbeddedAiAssistantToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface EmbeddedAiAssistantGenerateInput {
  requestId: string
  messages: EmbeddedAiAssistantMessage[]
  mode?: 'auto' | 'json'
  tools?: EmbeddedAiAssistantToolDefinition[]
  maxTokens: number
  temperature: number
  reasoningEffort: EmbeddedAiAssistantReasoningEffort
}

export type EmbeddedAiAssistantReasoningEffort = 'low' | 'high' | 'xhigh' | 'max'

export interface EmbeddedAiAssistantGenerateResult {
  mode: 'tools' | 'json' | 'fallback'
  content: string
  toolCalls: EmbeddedAiAssistantToolCall[]
}

export interface EmbeddedAiAssistantBridge {
  getConfig(): Promise<EmbeddedAiAssistantConfig>
  saveConfig(input: EmbeddedAiAssistantConfigInput): Promise<EmbeddedAiAssistantConfig>
  generate(input: EmbeddedAiAssistantGenerateInput): Promise<EmbeddedAiAssistantGenerateResult>
  cancel(requestId: string): Promise<void>
}

export interface EmbeddedHostBridge {
  requestMediaImport?: (importFiles: ImportMediaFiles) => void
  /** Runs the host's local speech model. It never receives an editor path. */
  transcribeMedia?: (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => Promise<EmbeddedTranscriptResult>
  analyzeMediaVisual?: (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => Promise<EmbeddedVisualEvidence>
  /** The remote model connection is implemented by the trusted Electron host. */
  aiAssistant?: EmbeddedAiAssistantBridge
}

const EmbeddedHostContext = createContext<EmbeddedHostBridge>({})
let activeHostBridge: EmbeddedHostBridge = {}

/**
 * Non-React services (such as the internal AI tool registry) need the same
 * constrained bridge as UI components. FreeCut is mounted once per window, so
 * this remains window-local and is cleared with the provider.
 */
export function getEmbeddedHostBridge(): EmbeddedHostBridge {
  return activeHostBridge
}

export function EmbeddedHostProvider({
  bridge,
  children,
}: {
  bridge: EmbeddedHostBridge
  children: ReactNode
}) {
  useEffect(() => {
    activeHostBridge = bridge
    return () => {
      if (activeHostBridge === bridge) activeHostBridge = {}
    }
  }, [bridge])

  return <EmbeddedHostContext.Provider value={bridge}>{children}</EmbeddedHostContext.Provider>
}

export function useEmbeddedHost(): EmbeddedHostBridge {
  return useContext(EmbeddedHostContext)
}

declare module '@freecut/embedded' {
  import type { ComponentType } from 'react'

  export type ImportMediaFiles = (files: File[]) => Promise<void>

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

  export interface EmbeddedAiAssistantGenerateInput {
    requestId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    maxTokens: number
    temperature: number
  }

  export interface FreeCutEditorProps {
    onRequestMediaImport?: (importFiles: ImportMediaFiles) => void
    onTranscribeMedia?: (source: EmbeddedMediaSource) => Promise<EmbeddedTranscriptResult>
    onAnalyzeMediaVisual?: (source: EmbeddedMediaSource) => Promise<EmbeddedVisualEvidence>
    onGetAiAssistantConfig?: () => Promise<EmbeddedAiAssistantConfig>
    onSaveAiAssistantConfig?: (input: EmbeddedAiAssistantConfigInput) => Promise<EmbeddedAiAssistantConfig>
    onGenerateAiAssistant?: (input: EmbeddedAiAssistantGenerateInput) => Promise<string>
    onCancelAiAssistant?: (requestId: string) => Promise<void>
  }

  export const FreeCutEditor: ComponentType<FreeCutEditorProps>
}

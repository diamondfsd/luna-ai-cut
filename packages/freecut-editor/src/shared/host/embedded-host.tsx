import { createContext, useContext, useEffect, type ReactNode } from 'react'

export interface EmbeddedMediaImportSource {
  path: string
  name: string
  mimeType: string
  size: number
  lastModified: number
}

export interface EmbeddedNativeMediaFile extends Omit<EmbeddedMediaImportSource, 'path' | 'size'> {
  bytes: ArrayBuffer
}

export type ImportMediaFiles = (sources: EmbeddedMediaImportSource[]) => Promise<void>

/** Media identity supplied to host-side analysis without transferring source bytes. */
export interface EmbeddedMediaSource {
  mediaId: string
  nativePath?: string
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
  intensity: EmbeddedVisualAnalysisIntensity
}

export type EmbeddedVisualAnalysisIntensity = 'light' | 'normal' | 'strong'

export interface EmbeddedTaskProgress {
  label: string
  percent: number | null
}

export interface EmbeddedHtmlRenderRequest {
  html: string
  css: string
  width: number
  height: number
  timeMs: number
}

export interface EmbeddedHtmlRenderResult {
  png: ArrayBuffer
  width: number
  height: number
  warnings: string[]
}

export interface EmbeddedExportFile {
  fileName: string
  data: Blob
}

export interface EmbeddedExportSaveResult {
  fileName: string
  filePath: string
}

export interface EmbeddedExportBridge {
  getDirectory(): Promise<string | null>
  chooseDirectory(): Promise<string | null>
  saveFiles(
    directory: string,
    files: EmbeddedExportFile[],
    signal?: AbortSignal,
  ): Promise<EmbeddedExportSaveResult[]>
  revealFile(filePath: string): Promise<void>
}

export interface EmbeddedAiAssistantConfig {
  baseUrl: string
  model: string
  contextWindowTokens: number
  hasApiKey: boolean
  nativeToolCalling: boolean
}

export interface EmbeddedAiAssistantConfigInput {
  baseUrl: string
  model: string
  contextWindowTokens: number
  apiKey?: string
  clearApiKey?: boolean
  nativeToolCalling?: boolean
}

export interface EmbeddedAiAssistantConfigTestResult {
  config: EmbeddedAiAssistantConfig
  connected: boolean
  nativeToolCalling: boolean
  message: string
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

export interface EmbeddedAiAssistantTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
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
  usage?: EmbeddedAiAssistantTokenUsage
}

export interface EmbeddedAiAssistantRequestStatus {
  requestId: string
  attempt: number
  maxAttempts: number
  state: 'waiting' | 'retrying' | 'streaming'
  previewText?: string
  previewKind?: 'reasoning' | 'content'
}

export interface EmbeddedAiAssistantBridge {
  getConfig(): Promise<EmbeddedAiAssistantConfig>
  saveConfig(input: EmbeddedAiAssistantConfigInput): Promise<EmbeddedAiAssistantConfig>
  testConfig(input: EmbeddedAiAssistantConfigInput): Promise<EmbeddedAiAssistantConfigTestResult>
  generate(input: EmbeddedAiAssistantGenerateInput): Promise<EmbeddedAiAssistantGenerateResult>
  cancel(requestId: string): Promise<void>
  onStatus(callback: (status: EmbeddedAiAssistantRequestStatus) => void): () => void
}

export interface EmbeddedAiEditingSourceGitBridge {
  ensure(
    projectId: string,
    initialFiles?: Record<string, string>,
  ): Promise<{ created: boolean; head: string | null }>
  status(projectId: string): Promise<{
    branch: string | null
    clean: boolean
    entries: Array<{ path: string; change: 'added' | 'modified' | 'deleted' }>
  }>
  list(
    projectId: string,
    sourceDirectory?: string,
  ): Promise<
    Array<{
      path: string
      name: string
      type: 'file' | 'directory'
    }>
  >
  read(projectId: string, sourcePath: string): Promise<string>
  create(projectId: string, sourcePath: string, content: string): Promise<void>
  replace(
    projectId: string,
    input: { path: string; oldText: string; newText: string; replaceAll?: boolean },
  ): Promise<{ changed: boolean; content: string; replacements: number }>
  write(projectId: string, sourcePath: string, content: string): Promise<void>
  remove(projectId: string, sourcePath: string, expectedRevision?: string): Promise<void>
  applyChanges(
    projectId: string,
    changes: Array<{
      path: string
      content: string | null
      expectedContent?: string | null
      expectedRevision?: string
    }>,
  ): Promise<void>
  diff(projectId: string): Promise<
    Array<{
      path: string
      change: 'added' | 'modified' | 'deleted'
      before: string | null
      after: string | null
    }>
  >
  log(
    projectId: string,
    limit?: number,
  ): Promise<
    Array<{
      oid: string
      message: string
      author: { name: string; email: string; timestamp: number }
    }>
  >
  branches(projectId: string): Promise<{ current: string | null; names: string[] }>
  createBranch(projectId: string, name: string): Promise<void>
  checkout(projectId: string, name: string): Promise<void>
  resetToInitial(projectId: string): Promise<{
    changed: boolean
    initialCommitId: string
    commitId: string
  }>
  commit(projectId: string, message: string, sourcePaths?: string[]): Promise<string>
}

export interface EmbeddedHostBridge {
  requestMediaImport?: (importFiles: ImportMediaFiles) => void | Promise<void>
  describeDroppedMediaFiles?: (files: File[]) => Promise<EmbeddedMediaImportSource[]>
  inspectNativeMediaFile?: (filePath: string) => Promise<EmbeddedMediaImportSource>
  readNativeMediaFile?: (filePath: string) => Promise<EmbeddedNativeMediaFile>
  resolveNativeMediaUrl?: (filePath: string) => string
  /** Runs the host's local speech model. It never receives an editor path. */
  transcribeMedia?: (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => Promise<EmbeddedTranscriptResult>
  analyzeMediaVisual?: (
    source: EmbeddedMediaSource,
    intensity: EmbeddedVisualAnalysisIntensity,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => Promise<EmbeddedVisualEvidence>
  /** The remote model connection is implemented by the trusted Electron host. */
  aiAssistant?: EmbeddedAiAssistantBridge
  editingSourceGit?: EmbeddedAiEditingSourceGitBridge
  renderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
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

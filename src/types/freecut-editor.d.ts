declare module '@freecut/embedded' {
  import type { ComponentType } from 'react'

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

  export interface EmbeddedDeepSeekHarnessConfig {
    baseUrl: string
    model: string
    contextWindowTokens: number
    maxOutputTokens: number
    hasApiKey: boolean
  }

  export interface EmbeddedDeepSeekHarnessConfigInput {
    baseUrl: string
    model: string
    contextWindowTokens: number
    maxOutputTokens: number
    apiKey?: string
    clearApiKey?: boolean
  }

  export interface EmbeddedDeepSeekHarnessConfigTestResult {
    config: EmbeddedDeepSeekHarnessConfig
    connected: boolean
    message: string
  }

  export interface EmbeddedDeepSeekHarnessWebState {
    projectId: string
    status: 'starting' | 'ready' | 'error'
    url?: string
    error?: string
  }

  export interface EmbeddedDeepSeekHarnessSourceToolRequest {
    requestId: string
    projectId: string
    name: string
    args: Record<string, unknown>
  }

  export interface EmbeddedDeepSeekHarnessBridge {
    getConfig(): Promise<EmbeddedDeepSeekHarnessConfig>
    saveConfig(input: EmbeddedDeepSeekHarnessConfigInput): Promise<EmbeddedDeepSeekHarnessConfig>
    testConfig(input: EmbeddedDeepSeekHarnessConfigInput): Promise<EmbeddedDeepSeekHarnessConfigTestResult>
    getWebUrl(projectId: string): Promise<string>
    onWebState(callback: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void
    onSourceToolRequest(callback: (request: EmbeddedDeepSeekHarnessSourceToolRequest) => Promise<unknown>): () => void
  }

  export interface EmbeddedAiEditingSourceGitBridge {
    root(projectId: string): Promise<string>
    ensure(projectId: string, initialFiles?: Record<string, string>): Promise<{ created: boolean; head: string | null }>
    status(projectId: string): Promise<{ branch: string | null; clean: boolean; entries: Array<{ path: string; change: 'added' | 'modified' | 'deleted' }> }>
    list(projectId: string, sourceDirectory?: string): Promise<Array<{ path: string; name: string; type: 'file' | 'directory' }>>
    read(projectId: string, sourcePath: string): Promise<string>
    create(projectId: string, sourcePath: string, content: string): Promise<void>
    replace(projectId: string, input: { path: string; oldText: string; newText: string; replaceAll?: boolean }): Promise<{ changed: boolean; content: string; replacements: number }>
    write(projectId: string, sourcePath: string, content: string): Promise<void>
    remove(projectId: string, sourcePath: string, expectedRevision?: string): Promise<void>
    applyChanges(projectId: string, changes: Array<{ path: string; content: string | null; expectedContent?: string | null; expectedRevision?: string }>): Promise<void>
    diff(projectId: string): Promise<Array<{ path: string; change: 'added' | 'modified' | 'deleted'; before: string | null; after: string | null }>>
    log(projectId: string, limit?: number): Promise<Array<{ oid: string; message: string; author: { name: string; email: string; timestamp: number } }>>
    branches(projectId: string): Promise<{ current: string | null; names: string[] }>
    createBranch(projectId: string, name: string): Promise<void>
    checkout(projectId: string, name: string): Promise<void>
    resetToInitial(projectId: string): Promise<{ changed: boolean; initialCommitId: string; commitId: string }>
    commit(projectId: string, message: string, sourcePaths?: string[]): Promise<string>
  }

  export interface FreeCutEditorProps {
    onRequestMediaImport?: (importFiles: ImportMediaFiles) => void | Promise<void>
    onDescribeDroppedMediaFiles?: (files: File[]) => Promise<EmbeddedMediaImportSource[]>
    onInspectNativeMediaFile?: (filePath: string) => Promise<EmbeddedMediaImportSource>
    onReadNativeMediaFile?: (filePath: string) => Promise<EmbeddedNativeMediaFile>
    onResolveNativeMediaUrl?: (filePath: string) => string
    onTranscribeMedia?: (
      source: EmbeddedMediaSource,
      onProgress?: (progress: EmbeddedTaskProgress) => void,
    ) => Promise<EmbeddedTranscriptResult>
    onAnalyzeMediaVisual?: (
      source: EmbeddedMediaSource,
      intensity: EmbeddedVisualAnalysisIntensity,
      onProgress?: (progress: EmbeddedTaskProgress) => void,
    ) => Promise<EmbeddedVisualEvidence>
    onGetDeepSeekHarnessConfig?: () => Promise<EmbeddedDeepSeekHarnessConfig>
    onSaveDeepSeekHarnessConfig?: (input: EmbeddedDeepSeekHarnessConfigInput) => Promise<EmbeddedDeepSeekHarnessConfig>
    onTestDeepSeekHarnessConfig?: (input: EmbeddedDeepSeekHarnessConfigInput) => Promise<EmbeddedDeepSeekHarnessConfigTestResult>
    onGetDeepSeekHarnessWebUrl?: EmbeddedDeepSeekHarnessBridge['getWebUrl']
    onDeepSeekHarnessWebState?: EmbeddedDeepSeekHarnessBridge['onWebState']
    onDeepSeekHarnessSourceToolRequest?: EmbeddedDeepSeekHarnessBridge['onSourceToolRequest']
    editingSourceGit?: EmbeddedAiEditingSourceGitBridge
    onRenderHtmlFrame?: (
      request: EmbeddedHtmlRenderRequest,
    ) => Promise<EmbeddedHtmlRenderResult>
    exportFiles?: EmbeddedExportBridge
  }

  export const FreeCutEditor: ComponentType<FreeCutEditorProps>
}

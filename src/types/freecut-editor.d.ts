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

  export type ImportMediaFiles = (
    sources: EmbeddedMediaImportSource[],
    options?: { background?: boolean },
  ) => Promise<void>

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

  export interface EmbeddedDeepSeekHarnessWebState {
    projectId: string
    status: 'starting' | 'ready' | 'error'
    url?: string
    error?: string
  }

  export interface EmbeddedDeepSeekHarnessToolRequest {
    requestId: string
    projectId: string
    name: string
    args: Record<string, unknown>
  }

  export interface EmbeddedDeepSeekHarnessBridge {
    getWebUrl(projectId: string): Promise<string>
    onWebState(callback: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void
    onToolRequest(callback: (request: EmbeddedDeepSeekHarnessToolRequest) => Promise<unknown>): () => void
    onToolCancel(callback: (requestId: string) => void): () => void
  }

  export interface FreeCutEditorProps {
    onRequestMediaImport?: (importFiles: ImportMediaFiles) => void | Promise<void>
    onRevealFile?: (filePath: string) => Promise<void>
    onDescribeDroppedMediaFiles?: (files: File[]) => Promise<EmbeddedMediaImportSource[]>
    onInspectNativeMediaFile?: (filePath: string) => Promise<EmbeddedMediaImportSource>
    onReadNativeMediaFile?: (filePath: string) => Promise<EmbeddedNativeMediaFile>
    onResolveNativeMediaUrl?: (filePath: string) => string
    onTranscribeMedia?: (
      source: EmbeddedMediaSource,
      onProgress?: (progress: EmbeddedTaskProgress) => void,
      signal?: AbortSignal,
    ) => Promise<EmbeddedTranscriptResult>
    onGetDeepSeekHarnessWebUrl?: EmbeddedDeepSeekHarnessBridge['getWebUrl']
    onDeepSeekHarnessWebState?: EmbeddedDeepSeekHarnessBridge['onWebState']
    onDeepSeekHarnessToolRequest?: EmbeddedDeepSeekHarnessBridge['onToolRequest']
    onDeepSeekHarnessToolCancel?: EmbeddedDeepSeekHarnessBridge['onToolCancel']
    onRenderHtmlFrame?: (
      request: EmbeddedHtmlRenderRequest,
    ) => Promise<EmbeddedHtmlRenderResult>
    exportFiles?: EmbeddedExportBridge
  }

  export const FreeCutEditor: ComponentType<FreeCutEditorProps>
}

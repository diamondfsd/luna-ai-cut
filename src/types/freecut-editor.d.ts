declare module '@freecut/embedded' {
  import type { ComponentType } from 'react'

  export interface EmbeddedLunaEditorSdkBridge {
    onRequest: (callback: (request: {
      requestId: string
      sessionId: string
      projectId?: string
      name: string
      args: Record<string, unknown>
    }) => void) => () => void
    respond: (response: {
      requestId: string
      ok: boolean
      result?: unknown
      error?: { code?: string; message: string; details?: unknown; retryable?: boolean }
    }) => void
  }

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

  export interface EmbeddedSpeechGenerationRequest {
    requestId: string
    text: string
    voice: string
    speed: number
  }

  export interface EmbeddedMusicGenerationRequest {
    requestId: string
    model: 'small-music' | 'small-sfx'
    prompt: string
    durationSeconds: number
    guidanceScale?: number
    seed?: number
  }

  export interface EmbeddedGeneratedAudio {
    requestId: string
    fileName: string
    durationSeconds: number
    bytes: Uint8Array
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

  export interface EmbeddedProjectContext {
    id: string
    name: string
  }

  export interface FreeCutEditorProps {
    language?: string
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
    onGenerateSpeech?: (
      request: EmbeddedSpeechGenerationRequest,
      onProgress?: (progress: EmbeddedTaskProgress) => void,
      signal?: AbortSignal,
    ) => Promise<EmbeddedGeneratedAudio>
    onGenerateMusic?: (
      request: EmbeddedMusicGenerationRequest,
      onProgress?: (progress: EmbeddedTaskProgress) => void,
      signal?: AbortSignal,
    ) => Promise<EmbeddedGeneratedAudio>
    onRenderHtmlFrame?: (
      request: EmbeddedHtmlRenderRequest,
    ) => Promise<EmbeddedHtmlRenderResult>
    exportFiles?: EmbeddedExportBridge
    lunaEditorSdk?: EmbeddedLunaEditorSdkBridge
    onProjectContextChange?: (project: EmbeddedProjectContext | null) => void
  }

  export const FreeCutEditor: ComponentType<FreeCutEditorProps>
}

declare module '@freecut/app/debug' {
  export function initializeDebugUtils(): void | Promise<void>
}

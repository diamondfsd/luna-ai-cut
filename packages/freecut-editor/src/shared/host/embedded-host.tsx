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

export interface EmbeddedHostBridge {
  requestMediaImport?: (importFiles: ImportMediaFiles) => void | Promise<void>
  revealFile?: (filePath: string) => Promise<void>
  describeDroppedMediaFiles?: (files: File[]) => Promise<EmbeddedMediaImportSource[]>
  inspectNativeMediaFile?: (filePath: string) => Promise<EmbeddedMediaImportSource>
  readNativeMediaFile?: (filePath: string) => Promise<EmbeddedNativeMediaFile>
  resolveNativeMediaUrl?: (filePath: string) => string
  transcribeMedia?: (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
    signal?: AbortSignal,
  ) => Promise<EmbeddedTranscriptResult>
  renderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
}

const EmbeddedHostContext = createContext<EmbeddedHostBridge>({})
let activeHostBridge: EmbeddedHostBridge = {}

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

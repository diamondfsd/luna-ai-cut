import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { changeAppLanguage, i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type EmbeddedExportBridge,
  type EmbeddedHtmlRenderRequest,
  type EmbeddedHtmlRenderResult,
  type EmbeddedMediaImportSource,
  type EmbeddedMediaSource,
  type EmbeddedNativeMediaFile,
  type EmbeddedProjectContext,
  type EmbeddedTaskProgress,
  type EmbeddedTranscriptResult,
  type EmbeddedSpeechGenerationRequest,
  type EmbeddedMusicGenerationRequest,
  type EmbeddedGeneratedAudio,
  type EmbeddedLunaEditorSdkBridge,
  type ImportMediaFiles,
} from './shared/host/embedded-host'
import './index.css'

export interface FreeCutEditorProps {
  /** Embedded hosts can provide the host application's UI language explicitly. */
  language?: string
  onRequestMediaImport?: (importFiles: ImportMediaFiles) => void | Promise<void>
  onRevealFile?: (filePath: string) => Promise<void>
  onDescribeDroppedMediaFiles?: (files: File[]) => Promise<EmbeddedMediaImportSource[]>
  onInspectNativeMediaFile?: (filePath: string) => Promise<EmbeddedMediaImportSource>
  onReadNativeMediaFile?: (filePath: string) => Promise<EmbeddedNativeMediaFile>
  onResolveNativeMediaUrl?: (filePath: string) => string
  onResolveMediaSourcePath?: (mediaId: string) => Promise<string | null>
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
  onRenderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
  lunaEditorSdk?: EmbeddedLunaEditorSdkBridge
  onProjectContextChange?: (project: EmbeddedProjectContext | null) => void
}

export type { EmbeddedLunaEditorSdkBridge } from './shared/host/embedded-host'

export function FreeCutEditor({
  language,
  onRequestMediaImport,
  onRevealFile,
  onDescribeDroppedMediaFiles,
  onInspectNativeMediaFile,
  onReadNativeMediaFile,
  onResolveNativeMediaUrl,
  onResolveMediaSourcePath,
  onTranscribeMedia,
  onGenerateSpeech,
  onGenerateMusic,
  onRenderHtmlFrame,
  exportFiles,
  lunaEditorSdk,
  onProjectContextChange,
}: FreeCutEditorProps) {
  const [ready, setReady] = useState(false)
  const hostBridge = useMemo(
    () => ({
      requestMediaImport: onRequestMediaImport,
      revealFile: onRevealFile,
      describeDroppedMediaFiles: onDescribeDroppedMediaFiles,
      inspectNativeMediaFile: onInspectNativeMediaFile,
      readNativeMediaFile: onReadNativeMediaFile,
      resolveNativeMediaUrl: onResolveNativeMediaUrl,
      resolveMediaSourcePath: onResolveMediaSourcePath,
      transcribeMedia: onTranscribeMedia,
      generateSpeech: onGenerateSpeech,
      generateMusic: onGenerateMusic,
      renderHtmlFrame: onRenderHtmlFrame,
      exportFiles,
      lunaEditorSdk,
      onProjectContextChange,
    }),
    [
      onRequestMediaImport,
      onRevealFile,
      onDescribeDroppedMediaFiles,
      onInspectNativeMediaFile,
      onReadNativeMediaFile,
      onResolveNativeMediaUrl,
      onResolveMediaSourcePath,
      onTranscribeMedia,
      onGenerateSpeech,
      onGenerateMusic,
      onRenderHtmlFrame,
      exportFiles,
      lunaEditorSdk,
      onProjectContextChange,
    ],
  )

  useEffect(() => {
    document.body.classList.add('freecut-active')
    let active = true
    setReady(false)
    void i18nReady
      .then(() => (language ? changeAppLanguage(language) : undefined))
      .catch(() => undefined)
      .then(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
      document.body.classList.remove('freecut-active')
    }
  }, [language])

  if (!ready) return null

  return (
    <EmbeddedHostProvider bridge={hostBridge}>
      <div className="freecut-app dark size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
        <App />
      </div>
    </EmbeddedHostProvider>
  )
}

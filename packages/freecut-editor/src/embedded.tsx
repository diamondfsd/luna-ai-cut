import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type ImportMediaFiles,
  type EmbeddedMediaImportSource,
  type EmbeddedNativeMediaFile,
  type EmbeddedTranscriptResult,
  type EmbeddedVisualEvidence,
  type EmbeddedVisualAnalysisIntensity,
  type EmbeddedMediaSource,
  type EmbeddedTaskProgress,
  type EmbeddedAiAssistantConfig,
  type EmbeddedAiAssistantConfigInput,
  type EmbeddedAiAssistantGenerateInput,
  type EmbeddedAiAssistantGenerateResult,
  type EmbeddedAiAssistantBridge,
  type EmbeddedAiEditingSourceGitBridge,
  type EmbeddedHtmlRenderRequest,
  type EmbeddedHtmlRenderResult,
  type EmbeddedExportBridge,
} from './shared/host/embedded-host'
import { setHtmlFrameProvider } from './features/export/utils/html-frame-provider'
import './index.css'

export type {
  EmbeddedMediaImportSource,
  EmbeddedNativeMediaFile,
  ImportMediaFiles,
} from './shared/host/embedded-host'

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
  onGetAiAssistantConfig?: () => Promise<EmbeddedAiAssistantConfig>
  onSaveAiAssistantConfig?: (
    input: EmbeddedAiAssistantConfigInput,
  ) => Promise<EmbeddedAiAssistantConfig>
  onGenerateAiAssistant?: (
    input: EmbeddedAiAssistantGenerateInput,
  ) => Promise<EmbeddedAiAssistantGenerateResult>
  onCancelAiAssistant?: (requestId: string) => Promise<void>
  onAiAssistantStatus?: EmbeddedAiAssistantBridge['onStatus']
  editingSourceGit?: EmbeddedAiEditingSourceGitBridge
  onRenderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
}

export function FreeCutEditor({
  onRequestMediaImport,
  onDescribeDroppedMediaFiles,
  onInspectNativeMediaFile,
  onReadNativeMediaFile,
  onResolveNativeMediaUrl,
  onTranscribeMedia,
  onAnalyzeMediaVisual,
  onGetAiAssistantConfig,
  onSaveAiAssistantConfig,
  onGenerateAiAssistant,
  onCancelAiAssistant,
  onAiAssistantStatus,
  editingSourceGit,
  onRenderHtmlFrame,
  exportFiles,
}: FreeCutEditorProps) {
  const [ready, setReady] = useState(false)
  const hostBridge = useMemo(
    () => ({
      requestMediaImport: onRequestMediaImport,
      describeDroppedMediaFiles: onDescribeDroppedMediaFiles,
      inspectNativeMediaFile: onInspectNativeMediaFile,
      readNativeMediaFile: onReadNativeMediaFile,
      resolveNativeMediaUrl: onResolveNativeMediaUrl,
      transcribeMedia: onTranscribeMedia,
      analyzeMediaVisual: onAnalyzeMediaVisual,
      renderHtmlFrame: onRenderHtmlFrame,
      exportFiles,
      aiAssistant:
        onGetAiAssistantConfig &&
        onSaveAiAssistantConfig &&
        onGenerateAiAssistant &&
        onCancelAiAssistant &&
        onAiAssistantStatus
          ? {
              getConfig: onGetAiAssistantConfig,
              saveConfig: onSaveAiAssistantConfig,
              generate: onGenerateAiAssistant,
              cancel: onCancelAiAssistant,
              onStatus: onAiAssistantStatus,
            }
          : undefined,
      editingSourceGit,
    }),
    [
      onRequestMediaImport,
      onDescribeDroppedMediaFiles,
      onInspectNativeMediaFile,
      onReadNativeMediaFile,
      onResolveNativeMediaUrl,
      onTranscribeMedia,
      onAnalyzeMediaVisual,
      onRenderHtmlFrame,
      exportFiles,
      onGetAiAssistantConfig,
      onSaveAiAssistantConfig,
      onGenerateAiAssistant,
      onCancelAiAssistant,
      onAiAssistantStatus,
      editingSourceGit,
    ],
  )

  useEffect(() => {
    if (!onRenderHtmlFrame) {
      setHtmlFrameProvider(undefined)
      return
    }
    setHtmlFrameProvider(async ({ item, width, height, timeMs }) => {
      const result = await onRenderHtmlFrame({
        html: item.html,
        css: item.css,
        width,
        height,
        timeMs,
      })
      return createImageBitmap(new Blob([result.png], { type: 'image/png' }))
    })
    return () => setHtmlFrameProvider(undefined)
  }, [onRenderHtmlFrame])

  useEffect(() => {
    document.body.classList.add('freecut-active')
    let active = true
    void i18nReady.then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
      document.body.classList.remove('freecut-active')
    }
  }, [])

  if (!ready) return null

  return (
    <EmbeddedHostProvider bridge={hostBridge}>
      <div className="freecut-app dark size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
        <App />
      </div>
    </EmbeddedHostProvider>
  )
}

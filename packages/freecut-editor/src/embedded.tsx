import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type ImportMediaFiles,
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
  type EmbeddedHtmlRenderRequest,
  type EmbeddedHtmlRenderResult,
  type EmbeddedExportBridge,
} from './shared/host/embedded-host'
import { setHtmlFrameProvider } from './features/export/utils/html-frame-provider'
import './index.css'

export interface FreeCutEditorProps {
  onRequestMediaImport?: (importFiles: ImportMediaFiles) => void
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
  onRenderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
}

export function FreeCutEditor({
  onRequestMediaImport,
  onTranscribeMedia,
  onAnalyzeMediaVisual,
  onGetAiAssistantConfig,
  onSaveAiAssistantConfig,
  onGenerateAiAssistant,
  onCancelAiAssistant,
  onAiAssistantStatus,
  onRenderHtmlFrame,
  exportFiles,
}: FreeCutEditorProps) {
  const [ready, setReady] = useState(false)
  const hostBridge = useMemo(
    () => ({
      requestMediaImport: onRequestMediaImport,
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
    }),
    [
      onRequestMediaImport,
      onTranscribeMedia,
      onAnalyzeMediaVisual,
      onRenderHtmlFrame,
      exportFiles,
      onGetAiAssistantConfig,
      onSaveAiAssistantConfig,
      onGenerateAiAssistant,
      onCancelAiAssistant,
      onAiAssistantStatus,
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

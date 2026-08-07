import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type ImportMediaFiles,
  type EmbeddedTranscriptResult,
  type EmbeddedVisualEvidence,
  type EmbeddedMediaSource,
  type EmbeddedAiAssistantConfig,
  type EmbeddedAiAssistantConfigInput,
  type EmbeddedAiAssistantGenerateInput,
} from './shared/host/embedded-host'
import './index.css'

export interface FreeCutEditorProps {
  onRequestMediaImport?: (importFiles: ImportMediaFiles) => void
  onTranscribeMedia?: (source: EmbeddedMediaSource) => Promise<EmbeddedTranscriptResult>
  onAnalyzeMediaVisual?: (source: EmbeddedMediaSource) => Promise<EmbeddedVisualEvidence>
  onGetAiAssistantConfig?: () => Promise<EmbeddedAiAssistantConfig>
  onSaveAiAssistantConfig?: (input: EmbeddedAiAssistantConfigInput) => Promise<EmbeddedAiAssistantConfig>
  onGenerateAiAssistant?: (input: EmbeddedAiAssistantGenerateInput) => Promise<string>
  onCancelAiAssistant?: (requestId: string) => Promise<void>
}

export function FreeCutEditor({
  onRequestMediaImport,
  onTranscribeMedia,
  onAnalyzeMediaVisual,
  onGetAiAssistantConfig,
  onSaveAiAssistantConfig,
  onGenerateAiAssistant,
  onCancelAiAssistant,
}: FreeCutEditorProps) {
  const [ready, setReady] = useState(false)
  const hostBridge = useMemo(
    () => ({
      requestMediaImport: onRequestMediaImport,
      transcribeMedia: onTranscribeMedia,
      analyzeMediaVisual: onAnalyzeMediaVisual,
      aiAssistant: onGetAiAssistantConfig && onSaveAiAssistantConfig && onGenerateAiAssistant && onCancelAiAssistant
        ? {
            getConfig: onGetAiAssistantConfig,
            saveConfig: onSaveAiAssistantConfig,
            generate: onGenerateAiAssistant,
            cancel: onCancelAiAssistant,
          }
        : undefined,
    }),
    [
      onRequestMediaImport,
      onTranscribeMedia,
      onAnalyzeMediaVisual,
      onGetAiAssistantConfig,
      onSaveAiAssistantConfig,
      onGenerateAiAssistant,
      onCancelAiAssistant,
    ],
  )

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

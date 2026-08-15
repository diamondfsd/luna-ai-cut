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
  type EmbeddedAiEditingSourceGitBridge,
  type EmbeddedDeepSeekHarnessBridge,
  type EmbeddedDeepSeekHarnessConfig,
  type EmbeddedDeepSeekHarnessConfigInput,
  type EmbeddedDeepSeekHarnessConfigTestResult,
  type EmbeddedHtmlRenderRequest,
  type EmbeddedHtmlRenderResult,
  type EmbeddedExportBridge,
} from './shared/host/embedded-host'
import { setHtmlFrameProvider } from './features/export/utils/html-frame-provider'
import { executeProjectSourceTool } from './features/project-source/project-source-tools'
import './index.css'

export type {
  EmbeddedMediaImportSource,
  EmbeddedNativeMediaFile,
  ImportMediaFiles,
} from './shared/host/embedded-host'

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
  ) => Promise<EmbeddedTranscriptResult>
  onAnalyzeMediaVisual?: (
    source: EmbeddedMediaSource,
    intensity: EmbeddedVisualAnalysisIntensity,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => Promise<EmbeddedVisualEvidence>
  onGetDeepSeekHarnessConfig?: () => Promise<EmbeddedDeepSeekHarnessConfig>
  onSaveDeepSeekHarnessConfig?: (
    input: EmbeddedDeepSeekHarnessConfigInput,
  ) => Promise<EmbeddedDeepSeekHarnessConfig>
  onTestDeepSeekHarnessConfig?: (
    input: EmbeddedDeepSeekHarnessConfigInput,
  ) => Promise<EmbeddedDeepSeekHarnessConfigTestResult>
  onGetDeepSeekHarnessWebUrl?: EmbeddedDeepSeekHarnessBridge['getWebUrl']
  onDeepSeekHarnessWebState?: EmbeddedDeepSeekHarnessBridge['onWebState']
  onDeepSeekHarnessSourceToolRequest?: EmbeddedDeepSeekHarnessBridge['onSourceToolRequest']
  editingSourceGit?: EmbeddedAiEditingSourceGitBridge
  onRenderHtmlFrame?: (request: EmbeddedHtmlRenderRequest) => Promise<EmbeddedHtmlRenderResult>
  exportFiles?: EmbeddedExportBridge
}

export function FreeCutEditor({
  onRequestMediaImport,
  onRevealFile,
  onDescribeDroppedMediaFiles,
  onInspectNativeMediaFile,
  onReadNativeMediaFile,
  onResolveNativeMediaUrl,
  onTranscribeMedia,
  onAnalyzeMediaVisual,
  onGetDeepSeekHarnessConfig,
  onSaveDeepSeekHarnessConfig,
  onTestDeepSeekHarnessConfig,
  onGetDeepSeekHarnessWebUrl,
  onDeepSeekHarnessWebState,
  onDeepSeekHarnessSourceToolRequest,
  editingSourceGit,
  onRenderHtmlFrame,
  exportFiles,
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
      transcribeMedia: onTranscribeMedia,
      analyzeMediaVisual: onAnalyzeMediaVisual,
      renderHtmlFrame: onRenderHtmlFrame,
      exportFiles,
      deepseekHarness:
        onGetDeepSeekHarnessConfig &&
        onSaveDeepSeekHarnessConfig &&
        onTestDeepSeekHarnessConfig &&
        onGetDeepSeekHarnessWebUrl &&
        onDeepSeekHarnessWebState &&
        onDeepSeekHarnessSourceToolRequest
          ? {
              getConfig: onGetDeepSeekHarnessConfig,
              saveConfig: onSaveDeepSeekHarnessConfig,
              testConfig: onTestDeepSeekHarnessConfig,
              getWebUrl: onGetDeepSeekHarnessWebUrl,
              onWebState: onDeepSeekHarnessWebState,
              onSourceToolRequest: onDeepSeekHarnessSourceToolRequest,
            }
          : undefined,
      editingSourceGit,
    }),
    [
      onRequestMediaImport,
      onRevealFile,
      onDescribeDroppedMediaFiles,
      onInspectNativeMediaFile,
      onReadNativeMediaFile,
      onResolveNativeMediaUrl,
      onTranscribeMedia,
      onAnalyzeMediaVisual,
      onRenderHtmlFrame,
      exportFiles,
      onGetDeepSeekHarnessConfig,
      onSaveDeepSeekHarnessConfig,
      onTestDeepSeekHarnessConfig,
      onGetDeepSeekHarnessWebUrl,
      onDeepSeekHarnessWebState,
      onDeepSeekHarnessSourceToolRequest,
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
    if (!onDeepSeekHarnessSourceToolRequest) return undefined
    return onDeepSeekHarnessSourceToolRequest((request) =>
      executeProjectSourceTool(request.name, request.args, request.projectId),
    )
  }, [onDeepSeekHarnessSourceToolRequest])

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

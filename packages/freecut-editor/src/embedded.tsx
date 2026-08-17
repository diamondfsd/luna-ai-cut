import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type ImportMediaFiles,
  type EmbeddedMediaImportSource,
  type EmbeddedNativeMediaFile,
  type EmbeddedTranscriptResult,
  type EmbeddedMediaSource,
  type EmbeddedTaskProgress,
  type EmbeddedAiEditingSourceGitBridge,
  type EmbeddedDeepSeekHarnessBridge,
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
    signal?: AbortSignal,
  ) => Promise<EmbeddedTranscriptResult>
  onGetDeepSeekHarnessWebUrl?: EmbeddedDeepSeekHarnessBridge['getWebUrl']
  onDeepSeekHarnessWebState?: EmbeddedDeepSeekHarnessBridge['onWebState']
  onDeepSeekHarnessSourceToolRequest?: EmbeddedDeepSeekHarnessBridge['onSourceToolRequest']
  onDeepSeekHarnessSourceToolCancel?: EmbeddedDeepSeekHarnessBridge['onSourceToolCancel']
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
  onGetDeepSeekHarnessWebUrl,
  onDeepSeekHarnessWebState,
  onDeepSeekHarnessSourceToolRequest,
  onDeepSeekHarnessSourceToolCancel,
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
      renderHtmlFrame: onRenderHtmlFrame,
      exportFiles,
      deepseekHarness:
        onGetDeepSeekHarnessWebUrl &&
        onDeepSeekHarnessWebState &&
        onDeepSeekHarnessSourceToolRequest
        && onDeepSeekHarnessSourceToolCancel
          ? {
              getWebUrl: onGetDeepSeekHarnessWebUrl,
              onWebState: onDeepSeekHarnessWebState,
              onSourceToolRequest: onDeepSeekHarnessSourceToolRequest,
              onSourceToolCancel: onDeepSeekHarnessSourceToolCancel,
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
      onRenderHtmlFrame,
      exportFiles,
      onGetDeepSeekHarnessWebUrl,
      onDeepSeekHarnessWebState,
      onDeepSeekHarnessSourceToolRequest,
      onDeepSeekHarnessSourceToolCancel,
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
    if (!onDeepSeekHarnessSourceToolRequest || !onDeepSeekHarnessSourceToolCancel) return undefined
    const controllers = new Map<string, AbortController>()
    const unsubscribeRequest = onDeepSeekHarnessSourceToolRequest((request) => {
      const controller = new AbortController()
      controllers.set(request.requestId, controller)
      return executeProjectSourceTool(request.name, request.args, request.projectId, controller.signal)
        .finally(() => controllers.delete(request.requestId))
    })
    const unsubscribeCancel = onDeepSeekHarnessSourceToolCancel((requestId) => {
      controllers.get(requestId)?.abort(new DOMException('源码工具调用已取消。', 'AbortError'))
    })
    return () => {
      unsubscribeRequest()
      unsubscribeCancel()
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [onDeepSeekHarnessSourceToolCancel, onDeepSeekHarnessSourceToolRequest])

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

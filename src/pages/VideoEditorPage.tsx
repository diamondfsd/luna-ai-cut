import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type {
  EmbeddedMediaSource,
  EmbeddedTaskProgress,
  EmbeddedExportFile,
  EmbeddedMediaImportSource,
  ImportMediaFiles,
} from '@freecut/embedded'

import { LoadingIndicator } from '../ui'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import { filePathToNativeMediaPreviewUrl } from '../lib/fileUtils'
import './VideoEditorPage.css'

const FreeCutEditor = lazy(async () => {
  const module = await import('@freecut/embedded')
  return { default: module.FreeCutEditor }
})

const IMPORTED_SOURCE_PATHS_STORAGE_KEY = 'luna.freecut.imported-source-paths.v1'
const EXPORT_WRITE_CHUNK_BYTES = 4 * 1024 * 1024
function mediaSourceKey(source: Pick<EmbeddedMediaSource, 'fileName' | 'fileSize' | 'fileLastModified'>): string {
  return `${source.fileName}\u0000${source.fileSize}\u0000${source.fileLastModified ?? ''}`
}

function mediaSourceFallbackKey(source: Pick<EmbeddedMediaSource, 'fileName' | 'fileSize'>): string {
  return `${source.fileName}\u0000${source.fileSize}`
}

function loadImportedSourcePaths(): Map<string, string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(IMPORTED_SOURCE_PATHS_STORAGE_KEY) ?? '{}') as unknown
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return new Map()
    return new Map(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return new Map()
  }
}

function saveImportedSourcePath(key: string, filePath: string): void {
  try {
    const stored = Object.fromEntries(loadImportedSourcePaths())
    stored[key] = filePath
    window.localStorage.setItem(IMPORTED_SOURCE_PATHS_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // The imported media itself remains available even if its local source reference cannot be saved.
  }
}

function findImportedSourcePath(
  sourcePaths: Map<string, string>,
  source: Pick<EmbeddedMediaSource, 'fileName' | 'fileSize' | 'fileLastModified'>,
): string | undefined {
  const exactKey = mediaSourceKey(source)
  const fallbackKey = mediaSourceFallbackKey(source)
  const direct = sourcePaths.get(exactKey) ?? sourcePaths.get(fallbackKey)
  if (direct) return direct

  // Older entries used the full key only. File metadata timestamps can lose
  // sub-millisecond precision when they cross the Electron bridge, so retain
  // a same-name-and-size recovery path for already imported local media.
  const prefix = `${fallbackKey}\u0000`
  return [...sourcePaths.entries()].find(([key]) => key.startsWith(prefix))?.[1]
}

export function VideoEditorPage() {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const pendingImportRef = useRef<ImportMediaFiles | null>(null)
  const finishImportRequestRef = useRef<(() => void) | null>(null)
  const importedSourcePathsRef = useRef(new Map<string, string>())

  const handleRequestMediaImport = useCallback((importFiles: ImportMediaFiles) => {
    pendingImportRef.current = importFiles
    setImportDialogOpen(true)
    return new Promise<void>((resolve) => {
      finishImportRequestRef.current?.()
      finishImportRequestRef.current = resolve
    })
  }, [])

  const handleRevealFile = useCallback((filePath: string) => window.luna.revealFile(filePath), [])

  const handleImportPaths = useCallback(async (paths: string[]) => {
    const importFiles = pendingImportRef.current
    if (!importFiles) throw new Error('导入任务已取消')

    const uniquePaths = [...new Set(paths)]
    const sources = await Promise.all(
      uniquePaths.map((filePath) => window.luna.workspace.inspectMediaFile(filePath)),
    )
    for (const source of sources) {
      const identity = {
        fileName: source.name,
        fileSize: source.size,
        fileLastModified: source.lastModified,
      }
      for (const key of [mediaSourceKey(identity), mediaSourceFallbackKey(identity)]) {
        importedSourcePathsRef.current.set(key, source.path)
        saveImportedSourcePath(key, source.path)
      }
    }
    await importFiles(sources, { background: true })
  }, [])

  const handleDescribeDroppedMediaFiles = useCallback(async (files: File[]) => {
    const paths = files
      .map((file) => window.luna.workspace.getPathForFile(file))
      .filter((filePath) => filePath.length > 0)
    return Promise.all([...new Set(paths)].map((filePath) =>
      window.luna.workspace.inspectMediaFile(filePath)))
  }, [])

  const handleInspectNativeMediaFile = useCallback(
    (filePath: string): Promise<EmbeddedMediaImportSource> =>
      window.luna.workspace.inspectMediaFile(filePath),
    [],
  )

  const handleReadNativeMediaFile = useCallback(
    (filePath: string) => window.luna.workspace.readMediaFile(filePath),
    [],
  )

  const handleResolveNativeMediaUrl = useCallback(
    (filePath: string) => filePathToNativeMediaPreviewUrl(filePath) ?? filePath,
    [],
  )

  const handleImportDialogOpenChange = useCallback((open: boolean) => {
    setImportDialogOpen(open)
    if (!open) {
      pendingImportRef.current = null
      finishImportRequestRef.current?.()
      finishImportRequestRef.current = null
    }
  }, [])

  const handleTranscribeMedia = useCallback(async (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
    signal?: AbortSignal,
  ) => {
    const filePath = source.nativePath
      ?? findImportedSourcePath(importedSourcePathsRef.current, source)
      ?? findImportedSourcePath(loadImportedSourcePaths(), source)
    if (!filePath) throw new Error('这段素材需要重新导入后才能使用本地口播识别。')
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) {
      throw new Error('这段素材的时长尚未准备完成，请稍后再试。')
    }

    const requestId = crypto.randomUUID()
    const abort = (): void => {
      void window.luna.workspace.cancelSubtitleTranscription(requestId)
    }
    signal?.throwIfAborted()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const unsubscribe = window.luna.onWorkspaceSubtitleProgress((progress) => {
      if (progress.requestId !== requestId) return
      onProgress?.({ label: progress.label, percent: progress.percent })
    })
    try {
      const result = await window.luna.workspace.transcribeSubtitles({
        requestId,
        filePath,
        startMs: 0,
        endMs: Math.max(1, Math.round(source.durationSeconds * 1_000)),
        language: 'auto',
      })
      return {
        language: result.language,
        cues: result.cues.map((cue) => ({
          startSeconds: cue.startMs / 1_000,
          endSeconds: cue.endMs / 1_000,
          text: cue.text,
        })),
        model: { id: result.model.id, version: result.model.version },
        sourceFingerprint: result.sourceFingerprint,
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      unsubscribe()
    }
  }, [])

  const handleGetDeepSeekHarnessWebUrl = useCallback((projectId: string) =>
    window.luna.deepseekHarness.getWebUrl(projectId), [])
  const handleDeepSeekHarnessWebState = useCallback((callback: Parameters<typeof window.luna.deepseekHarness.onWebState>[0]) =>
    window.luna.deepseekHarness.onWebState(callback), [])
  const handleDeepSeekHarnessToolRequest = useCallback((callback: Parameters<typeof window.luna.deepseekHarness.onToolRequest>[0]) =>
    window.luna.deepseekHarness.onToolRequest(callback), [])
  const handleDeepSeekHarnessToolCancel = useCallback((callback: Parameters<typeof window.luna.deepseekHarness.onToolCancel>[0]) =>
    window.luna.deepseekHarness.onToolCancel(callback), [])
  const handleRenderHtmlFrame = useCallback(
    (request: Parameters<typeof window.lunaHtmlRenderer.render>[0]) =>
      window.lunaHtmlRenderer.render(request),
    [],
  )

  const saveExportBlob = useCallback(async (
    directory: string,
    file: EmbeddedExportFile,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted()
    const opened = await window.luna.freecutExport.openWriter(directory, file.fileName)
    try {
      for (let offset = 0; offset < file.data.size; offset += EXPORT_WRITE_CHUNK_BYTES) {
        signal?.throwIfAborted()
        const chunk = await file.data.slice(offset, offset + EXPORT_WRITE_CHUNK_BYTES).arrayBuffer()
        await window.luna.freecutExport.writeWriter(opened.writerId, chunk)
      }
      signal?.throwIfAborted()
      return await window.luna.freecutExport.closeWriter(opened.writerId)
    } catch (error) {
      await window.luna.freecutExport.abortWriter(opened.writerId).catch(() => undefined)
      throw error
    }
  }, [])

  const exportFiles = useMemo(() => ({
    getDirectory: async () => (await window.luna.getSettings()).exportDir ?? null,
    chooseDirectory: () => window.luna.chooseExportDir(),
    saveFiles: async (directory: string, files: EmbeddedExportFile[], signal?: AbortSignal) => {
      const saved = []
      for (const file of files) saved.push(await saveExportBlob(directory, file, signal))
      return saved
    },
    revealFile: (filePath: string) => window.luna.revealFile(filePath),
  }), [saveExportBlob])

  return (
    <div className="video-editor-page">
      <Suspense
        fallback={(
          <div className="video-editor-loading">
            <LoadingIndicator label="正在打开剪辑器" />
          </div>
        )}
      >
        <FreeCutEditor
          onRequestMediaImport={handleRequestMediaImport}
          onRevealFile={handleRevealFile}
          onDescribeDroppedMediaFiles={handleDescribeDroppedMediaFiles}
          onInspectNativeMediaFile={handleInspectNativeMediaFile}
          onReadNativeMediaFile={handleReadNativeMediaFile}
          onResolveNativeMediaUrl={handleResolveNativeMediaUrl}
          onTranscribeMedia={handleTranscribeMedia}
          onGetDeepSeekHarnessWebUrl={handleGetDeepSeekHarnessWebUrl}
          onDeepSeekHarnessWebState={handleDeepSeekHarnessWebState}
          onDeepSeekHarnessToolRequest={handleDeepSeekHarnessToolRequest}
          onDeepSeekHarnessToolCancel={handleDeepSeekHarnessToolCancel}
          onRenderHtmlFrame={handleRenderHtmlFrame}
          exportFiles={exportFiles}
        />
      </Suspense>
      <WorkspaceImportDialog
        open={importDialogOpen}
        onOpenChange={handleImportDialogOpenChange}
        existingPaths={new Set()}
        onImportPaths={handleImportPaths}
        enableDirectoryImport
      />
    </div>
  )
}

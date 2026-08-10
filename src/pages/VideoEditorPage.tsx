import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import type {
  EmbeddedAiAssistantConfigInput,
  EmbeddedAiAssistantGenerateInput,
  EmbeddedMediaSource,
  EmbeddedTaskProgress,
  EmbeddedVisualAnalysisIntensity,
  ImportMediaFiles,
} from '@freecut/embedded'

import { LoadingIndicator } from '../ui'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import './VideoEditorPage.css'

const FreeCutEditor = lazy(async () => {
  const module = await import('@freecut/embedded')
  return { default: module.FreeCutEditor }
})

const IMPORTED_SOURCE_PATHS_STORAGE_KEY = 'luna.freecut.imported-source-paths.v1'
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
  const importedSourcePathsRef = useRef(new Map<string, string>())

  const handleRequestMediaImport = useCallback((importFiles: ImportMediaFiles) => {
    pendingImportRef.current = importFiles
    setImportDialogOpen(true)
  }, [])

  const handleImportPaths = useCallback(async (paths: string[]) => {
    const importFiles = pendingImportRef.current
    if (!importFiles) throw new Error('导入任务已取消')

    const uniquePaths = [...new Set(paths)]
    const files: File[] = []
    const importedSources: Array<{
      source: Pick<EmbeddedMediaSource, 'fileName' | 'fileSize' | 'fileLastModified'>
      filePath: string
    }> = []
    for (const filePath of uniquePaths) {
      const source = await window.luna.workspace.readMediaFile(filePath)
      files.push(new File([source.bytes], source.name, {
        type: source.mimeType,
        lastModified: source.lastModified,
      }))
      importedSources.push({
        source: {
          fileName: source.name,
          fileSize: source.bytes.byteLength,
          fileLastModified: source.lastModified,
        },
        filePath,
      })
    }
    for (const source of importedSources) {
      for (const key of [mediaSourceKey(source.source), mediaSourceFallbackKey(source.source)]) {
        importedSourcePathsRef.current.set(key, source.filePath)
        saveImportedSourcePath(key, source.filePath)
      }
    }
    await importFiles(files)
  }, [])

  const handleImportDialogOpenChange = useCallback((open: boolean) => {
    setImportDialogOpen(open)
    if (!open) pendingImportRef.current = null
  }, [])

  const handleTranscribeMedia = useCallback(async (
    source: EmbeddedMediaSource,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => {
    const filePath = findImportedSourcePath(importedSourcePathsRef.current, source)
      ?? findImportedSourcePath(loadImportedSourcePaths(), source)
    if (!filePath) throw new Error('这段素材需要重新导入后才能使用本地口播识别。')
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) {
      throw new Error('这段素材的时长尚未准备完成，请稍后再试。')
    }

    const requestId = crypto.randomUUID()
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
      unsubscribe()
    }
  }, [])

  const handleAnalyzeMediaVisual = useCallback(async (
    source: EmbeddedMediaSource,
    intensity: EmbeddedVisualAnalysisIntensity,
    onProgress?: (progress: EmbeddedTaskProgress) => void,
  ) => {
    const filePath = findImportedSourcePath(importedSourcePathsRef.current, source)
      ?? findImportedSourcePath(loadImportedSourcePaths(), source)
      ?? await window.luna.freecutWorkspace.getMediaSourcePath(source.mediaId)
    if (!filePath) throw new Error('这段素材没有可用的原始文件，无法进行本地画面分析。')
    const requestId = crypto.randomUUID()
    const unsubscribe = window.luna.onWorkspaceSegmentationProgress((progress) => {
      if (progress.requestId !== requestId) return
      onProgress?.({ label: progress.label, percent: progress.percent })
    })
    try {
      return await window.luna.workspace.analyzeVisualEvidence({
        requestId,
        filePath,
        durationSeconds: Math.max(0.1, source.durationSeconds),
        intensity,
      })
    } finally {
      unsubscribe()
    }
  }, [])

  const handleGetAiAssistantConfig = useCallback(() => window.luna.aiEditingAssistant.getConfig(), [])
  const handleSaveAiAssistantConfig = useCallback((input: EmbeddedAiAssistantConfigInput) =>
    window.luna.aiEditingAssistant.saveConfig(input), [])
  const handleGenerateAiAssistant = useCallback((input: EmbeddedAiAssistantGenerateInput) =>
    window.luna.aiEditingAssistant.generate(input), [])
  const handleCancelAiAssistant = useCallback((requestId: string) =>
    window.luna.aiEditingAssistant.cancel(requestId), [])
  const handleAiAssistantStatus = useCallback((callback: Parameters<typeof window.luna.aiEditingAssistant.onStatus>[0]) =>
    window.luna.aiEditingAssistant.onStatus(callback), [])

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
          onTranscribeMedia={handleTranscribeMedia}
          onAnalyzeMediaVisual={handleAnalyzeMediaVisual}
          onGetAiAssistantConfig={handleGetAiAssistantConfig}
          onSaveAiAssistantConfig={handleSaveAiAssistantConfig}
          onGenerateAiAssistant={handleGenerateAiAssistant}
          onCancelAiAssistant={handleCancelAiAssistant}
          onAiAssistantStatus={handleAiAssistantStatus}
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

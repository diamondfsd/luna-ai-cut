import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import type {
  EmbeddedAiAssistantConfigInput,
  EmbeddedAiAssistantGenerateInput,
  EmbeddedMediaSource,
  ImportMediaFiles,
} from '@freecut/embedded'

import { LoadingIndicator } from '../ui'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import './VideoEditorPage.css'

const FreeCutEditor = lazy(async () => {
  const module = await import('@freecut/embedded')
  return { default: module.FreeCutEditor }
})

function mediaSourceKey(source: Pick<EmbeddedMediaSource, 'fileName' | 'fileSize' | 'fileLastModified'>): string {
  return `${source.fileName}\u0000${source.fileSize}\u0000${source.fileLastModified ?? ''}`
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
    for (const filePath of uniquePaths) {
      const source = await window.luna.workspace.readMediaFile(filePath)
      files.push(new File([source.bytes], source.name, {
        type: source.mimeType,
        lastModified: source.lastModified,
      }))
      importedSourcePathsRef.current.set(mediaSourceKey({
        fileName: source.name,
        fileSize: source.bytes.byteLength,
        fileLastModified: source.lastModified,
      }), filePath)
    }
    await importFiles(files)
  }, [])

  const handleImportDialogOpenChange = useCallback((open: boolean) => {
    setImportDialogOpen(open)
    if (!open) pendingImportRef.current = null
  }, [])

  const handleTranscribeMedia = useCallback(async (source: EmbeddedMediaSource) => {
    const filePath = importedSourcePathsRef.current.get(mediaSourceKey(source))
    if (!filePath) throw new Error('这段素材需要重新导入后才能使用本地口播识别。')
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) {
      throw new Error('这段素材的时长尚未准备完成，请稍后再试。')
    }

    const result = await window.luna.workspace.transcribeSubtitles({
      requestId: crypto.randomUUID(),
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
  }, [])

  const handleAnalyzeMediaVisual = useCallback(async (source: EmbeddedMediaSource) => {
    const filePath = importedSourcePathsRef.current.get(mediaSourceKey(source))
    if (!filePath) throw new Error('这段素材需要重新导入后才能使用本地画面分析。')
    return window.luna.workspace.analyzeVisualEvidence({
      requestId: crypto.randomUUID(),
      filePath,
      durationSeconds: Math.max(0.1, source.durationSeconds),
    })
  }, [])

  const handleGetAiAssistantConfig = useCallback(() => window.luna.aiEditingAssistant.getConfig(), [])
  const handleSaveAiAssistantConfig = useCallback((input: EmbeddedAiAssistantConfigInput) =>
    window.luna.aiEditingAssistant.saveConfig(input), [])
  const handleGenerateAiAssistant = useCallback((input: EmbeddedAiAssistantGenerateInput) =>
    window.luna.aiEditingAssistant.generate(input), [])
  const handleCancelAiAssistant = useCallback((requestId: string) =>
    window.luna.aiEditingAssistant.cancel(requestId), [])

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

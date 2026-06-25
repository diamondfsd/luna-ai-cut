import { useEffect, useRef, useState } from 'react'
import { Check, Download, FileQuestion, FolderOpen, Loader2, X } from 'lucide-react'

import type { ExportProgress, LunaFile } from '../shared/types'
import { Button, IconButton, Panel, PanelBody, PanelHeader } from '../ui'
import '../styles/download-progress.css'

interface ExportProgressModalProps {
  exportProgress: Map<string, ExportProgress>
  fileSnapshots: Map<string, LunaFile>
  exporting: boolean
  setExporting: (exporting: boolean) => void
  onRevealFile: (path: string) => void
  onCanceled: () => void
}

const statusRank: Record<ExportProgress['status'], number> = {
  exporting: 0,
  queued: 1,
  failed: 2,
  canceled: 2,
  done: 3,
}

function filePathToPreviewUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  if (filePath.startsWith('file://')) return filePath
  return encodeURI(`file://${filePath}`).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function previewSourceFor(progress: ExportProgress, file: LunaFile | undefined): string | null {
  const sourcePath = progress.destinationPath ?? file?.thumbnailUrl ?? file?.downloadFilePath ?? file?.localPath
  return filePathToPreviewUrl(sourcePath)
}

function statusLabel(progress: ExportProgress): string {
  if (progress.status === 'queued') return '等待中'
  if (progress.status === 'exporting') return progress.percent !== null ? `${Math.round(progress.percent)}%` : '导出中'
  if (progress.status === 'failed') return '失败'
  if (progress.status === 'canceled') return '已取消'
  return '已完成'
}

export function ExportProgressModal({
  exportProgress,
  fileSnapshots,
  exporting,
  setExporting,
  onRevealFile,
  onCanceled,
}: ExportProgressModalProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target instanceof Node ? event.target : null
      if (!target || rootRef.current?.contains(target)) return
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const entries = [...exportProgress.values()].sort((a, b) => {
    const statusOrder = statusRank[a.status] - statusRank[b.status]
    return statusOrder || a.index - b.index || a.fileName.localeCompare(b.fileName)
  })
  const totalCount = entries.length
  const completedCount = entries.filter((progress) => progress.status === 'done').length
  const failedCount = entries.filter((progress) => progress.status === 'failed').length
  const canceledCount = entries.filter((progress) => progress.status === 'canceled').length
  const activeCount = entries.filter((progress) => progress.status === 'exporting').length
  const queuedCount = entries.filter((progress) => progress.status === 'queued').length
  const overallPercent = totalCount > 0
    ? entries.reduce((sum, progress) => {
      if (progress.status === 'done') return sum + 100
      if (progress.status === 'failed' || progress.status === 'canceled') return sum
      return sum + (progress.percent ?? 0)
    }, 0) / totalCount
    : 0

  if (totalCount === 0) return null

  async function cancelExports(): Promise<void> {
    setExporting(false)
    onCanceled()
    await window.luna.cancelExports()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className={`download-badge ${activeCount > 0 ? 'is-active' : ''} ${failedCount > 0 ? 'has-failed' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={exporting ? `导出中 (${activeCount + queuedCount})` : `${completedCount} 个已完成`}
      >
        {activeCount > 0 ? (
          <Loader2 className="spin" size={16} />
        ) : failedCount > 0 || canceledCount > 0 ? (
          <X size={14} />
        ) : (
          <Check size={14} />
        )}
        <span className="download-badge-count">
          {completedCount}/{totalCount}
        </span>
        <span className="download-badge-pct">{Math.round(overallPercent)}%</span>
      </button>

      {open && (
        <>
          <div className="dl-panel-backdrop" onClick={() => setOpen(false)} />
          <Panel className="dl-dropdown-panel" onPointerDown={(event) => event.stopPropagation()}>
            <PanelHeader>
              <h2>
                <Download size={16} />
                导出进度
              </h2>
              {(activeCount + queuedCount > 0) && (
                <Button variant="secondary" size="compact" className="dl-cancel-button" onClick={() => void cancelExports()} icon={<X size={14} />}>
                  取消
                </Button>
              )}
            </PanelHeader>
            <PanelBody>
              <div className="dl-overall">
                <div className="dl-overall-stats">
                  <span className="dl-overall-label">
                    已完成 {completedCount}/{totalCount}
                    {queuedCount > 0 && `，${queuedCount} 个等待`}
                    {failedCount > 0 && `，${failedCount} 个失败`}
                    {canceledCount > 0 && `，${canceledCount} 个已取消`}
                  </span>
                  <span className="dl-overall-pct">{Math.round(overallPercent)}%</span>
                </div>
                <div className="dl-overall-track">
                  <div className="dl-overall-fill" style={{ width: `${Math.min(100, overallPercent)}%` }} />
                </div>
              </div>

              <div className="dl-file-list">
                {entries.map((progress) => {
                  const file = fileSnapshots.get(progress.fileName)
                  const previewSource = previewSourceFor(progress, file)
                  const isVideoPreview = file?.kind === 'video' || file?.kind === 'lrv'
                  const pct = progress.status === 'done' ? 100 : progress.percent ?? 0
                  return (
                    <div key={progress.fileName} className={`dl-file-item ${progress.status}`}>
                      <div className="dl-file-preview">
                        {previewSource && !isVideoPreview && <img src={previewSource} alt="" loading="lazy" />}
                        {previewSource && isVideoPreview && <video src={previewSource} muted playsInline preload="metadata" />}
                        {!previewSource && <FileQuestion size={18} />}
                      </div>
                      <div className="dl-file-info">
                        <span className="dl-file-name">{progress.fileName}</span>
                        <span className="dl-file-meta">
                          {progress.status === 'done' && '已导出'}
                          {progress.status === 'queued' && '等待中'}
                          {progress.status === 'exporting' && '正在合成水印'}
                          {progress.status === 'failed' && (progress.error ? `失败 · ${progress.error}` : '失败')}
                          {progress.status === 'canceled' && '已取消'}
                        </span>
                        <div className="dl-file-progress-track">
                          <div className="dl-file-progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                      <div className="dl-file-actions">
                        {progress.status === 'done' && progress.destinationPath && (
                          <IconButton
                            variant="light"
                            onClick={() => onRevealFile(progress.destinationPath!)}
                            title="在文件夹中显示"
                            icon={<FolderOpen size={14} />}
                          />
                        )}
                        <span className={progress.status === 'failed' || progress.status === 'canceled' ? 'dl-file-status muted' : 'dl-file-status'}>
                          {statusLabel(progress)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  )
}

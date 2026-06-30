import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Eye, FileQuestion, FolderOpen, Loader2, X } from 'lucide-react'

import { logger } from '../lib/rendererLogger'
import type { ExportProgress, LunaFile } from '../shared/types'
import { PreviewModal } from './PreviewModal'
import { Button, DropdownPanel, IconButton } from '../ui'
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
  const normalized = filePath.replace(/\\/g, '/')
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
    .replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function previewSourceFor(progress: ExportProgress, file: LunaFile | undefined, readyThumbnailUrls?: Map<string, string>): string | null {
  const readyUrl = file ? readyThumbnailUrls?.get(file.name) : null
  const sourcePath = progress.destinationPath ?? readyUrl ?? file?.thumbnailUrl ?? file?.downloadFilePath ?? file?.localPath
  return filePathToPreviewUrl(sourcePath)
}

function statusLabel(progress: ExportProgress): string {
  if (progress.status === 'queued') return '等待中'
  if (progress.status === 'exporting') return progress.percent !== null ? `${Math.round(progress.percent)}%` : '导出中'
  if (progress.status === 'failed') return '失败'
  if (progress.status === 'canceled') return '已取消'
  return '已完成'
}

function taskStatus(items: ExportProgress[]): ExportProgress['status'] {
  if (items.some((item) => item.status === 'exporting')) return 'exporting'
  if (items.some((item) => item.status === 'queued')) return 'queued'
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'canceled')) return 'canceled'
  return 'done'
}

function taskPercent(items: ExportProgress[]): number {
  if (items.length === 0) return 0
  return items.reduce((sum, progress) => {
    if (progress.status === 'done') return sum + 100
    if (progress.status === 'failed' || progress.status === 'canceled') return sum
    return sum + (progress.percent ?? 0)
  }, 0) / items.length
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
  const [previewFile, setPreviewFile] = useState<LunaFile | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const readyThumbnailUrlsRef = useRef<Map<string, string>>(new Map())
  const [, forceUpdate] = useState(0)
  const requestedThumbnailIdsRef = useRef<Set<string>>(new Set())

  // 对导出队列中的文件主动请求缩略图缓存
  useEffect(() => {
    for (const file of fileSnapshots.values()) {
      if (file.thumbnailUrl || requestedThumbnailIdsRef.current.has(file.id)) continue
      requestedThumbnailIdsRef.current.add(file.id)
      window.luna.cacheFile(file).catch(() => {
        requestedThumbnailIdsRef.current.delete(file.id)
      })
    }
  }, [fileSnapshots])

  // 监听缩略图就绪，动态更新缩略图
  useEffect(() => {
    return window.luna.onThumbnailReady(({ fileId, fileName, thumbnailUrl }) => {
      for (const file of fileSnapshots.values()) {
        if (file.id === fileId || file.name === fileName) {
          readyThumbnailUrlsRef.current.set(file.name, thumbnailUrl)
          break
        }
      }
      forceUpdate((n) => n + 1)
    })
  }, [])

  const entries = [...exportProgress.values()].sort((a, b) => {
    const statusOrder = statusRank[a.status] - statusRank[b.status]
    return statusOrder || a.index - b.index || a.fileName.localeCompare(b.fileName)
  })
  const tasks = useMemo(() => {
    const groups = new Map<string, ExportProgress[]>()
    for (const progress of exportProgress.values()) {
      const taskId = progress.taskId ?? progress.exportId ?? progress.fileName
      groups.set(taskId, [...(groups.get(taskId) ?? []), progress])
    }
    return [...groups.entries()]
      .map(([id, items]) => ({
        id,
        title: items[0]?.taskName ?? `导出 ${items.length} 个文件`,
        createdAt: items[0]?.createdAt ?? 0,
        items: items.sort((a, b) => a.index - b.index),
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [exportProgress])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
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
    logger.warn('用户取消导出')
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

      {/* 导出进度下拉面板 */}
      <DropdownPanel
        open={open}
        triggerRef={rootRef}
        onClose={() => setOpen(false)}
        title={<><Download size={16} />导出进度</>}
        headerActions={(activeCount + queuedCount > 0) && (
          <Button variant="secondary" size="compact" className="dl-cancel-button" onClick={() => void cancelExports()} icon={<X size={14} />}>
            取消
          </Button>
        )}
      >
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

        <div className="dl-task-list">
          {tasks.map((task) => {
            const status = taskStatus(task.items)
            const percent = taskPercent(task.items)
            const done = task.items.filter((item) => item.status === 'done').length
            const failed = task.items.filter((item) => item.status === 'failed').length
            return (
              <button
                key={task.id}
                className={`dl-task-item ${selectedTask?.id === task.id ? 'active' : ''} ${status}`}
                type="button"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span className="dl-task-title">{task.title}</span>
                <span className="dl-task-meta">
                  {done}/{task.items.length}
                  {failed > 0 && `，${failed} 个失败`}
                  {' · '}
                  {Math.round(percent)}%
                </span>
                <span className="dl-task-track">
                  <span className="dl-task-fill" style={{ width: `${Math.min(100, percent)}%` }} />
                </span>
              </button>
            )
          })}
        </div>

        {selectedTask && (
          <div className="dl-file-list">
            {selectedTask.items.map((progress) => {
            const file = fileSnapshots.get(progress.exportId ?? progress.fileName)
            const previewSource = previewSourceFor(progress, file, readyThumbnailUrlsRef.current)
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
                    <>
                      <IconButton
                        variant="ghost"
                        onClick={() => {
                          const snap = fileSnapshots.get(progress.exportId ?? progress.fileName)
                          if (snap) {
                            const destPath = progress.destinationPath!
                            const exportedName = destPath.split(/[/\\]/).pop() ?? snap.name
                            setPreviewFile({
                              ...snap,
                              name: exportedName,
                              sourceUrl: filePathToPreviewUrl(destPath) ?? '',
                              url: filePathToPreviewUrl(destPath) ?? '',
                              localPath: destPath,
                              downloadFilePath: destPath,
                            })
                          }
                        }}
                        title="预览"
                        icon={<Eye size={14} />}
                      />
                      <IconButton
                        variant="ghost"
                        onClick={() => onRevealFile(progress.destinationPath!)}
                        title="在文件夹中显示"
                        icon={<FolderOpen size={14} />}
                      />
                    </>
                  )}
                  {progress.status !== 'done' && (
                    <span className={progress.status === 'failed' || progress.status === 'canceled' ? 'dl-file-status muted' : 'dl-file-status'}>
                      {statusLabel(progress)}
                    </span>
                  )}
                </div>
              </div>
            )
            })}
          </div>
        )}
      </DropdownPanel>

      {previewFile && (
        <PreviewModal
          files={[previewFile]}
          currentFile={previewFile}
          currentFileId={previewFile.id}
          preview={null}
          previewLoading={false}
          downloadProgress={undefined}
          isDownloadsPage={false}
          onClose={() => setPreviewFile(null)}
          onDownload={() => {}}
          onReveal={(f) => onRevealFile(f.downloadFilePath ?? f.localPath ?? '')}
          onFileChange={setPreviewFile}
        />
      )}
    </div>
  )
}

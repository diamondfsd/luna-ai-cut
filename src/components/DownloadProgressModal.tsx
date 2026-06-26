import { useEffect, useRef, useState } from 'react'
import { Check, Download, FileQuestion, FolderOpen, Loader2, X } from 'lucide-react'

import { formatBytes } from '../lib/format'
import type { DownloadProgress, LunaFile } from '../shared/types'
import { Button, DropdownPanel, IconButton } from '../ui'
import '../styles/download-progress.css'

interface DownloadProgressModalProps {
  downloadDir: string | undefined
  downloadQueue: LunaFile[]
  downloadProgress: Map<string, DownloadProgress>
  activeFileNames: Set<string>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
  setDownloading: (downloading: boolean) => void
  onFileDownloaded: (fileName: string, path: string) => void
  onQueueClear: () => void
  onQueueShift: (fileName: string) => void
  onRevealFile: (path: string) => void
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  if (bps > 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  if (bps > 1_000) return `${Math.round(bps / 1_000)} KB/s`
  return `${Math.round(bps)} B/s`
}

function previewSourceFor(progress: DownloadProgress, file: LunaFile | undefined, readyThumbnailUrls?: Map<string, string>): string | null {
  // 已完成下载的显示本地文件（全分辨率），否则使用和预览列表一致的缩略图路径
  if ((progress.status === 'done' || progress.status === 'exists') && progress.destinationPath) {
    const path = progress.destinationPath
    const normalized = path.replace(/\\/g, '/')
    const url = path.startsWith('file://') ? path : encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`).replace(/#/g, '%23').replace(/\?/g, '%3F')
    return url
  }
  // 优先使用 onThumbnailReady 回传的缩略图，回退到 file.thumbnailUrl
  const readyUrl = file ? readyThumbnailUrls?.get(file.name) : null
  return readyUrl ?? file?.thumbnailUrl ?? null
}

function statusLabel(progress: DownloadProgress): string {
  if (progress.status === 'queued') return '等待中'
  if (progress.status === 'downloading') return progress.percent !== null ? `${Math.round(progress.percent)}%` : '下载中'
  if (progress.status === 'failed') return '失败'
  if (progress.status === 'canceled') return '已取消'
  return '已完成'
}

const statusRank: Record<DownloadProgress['status'], number> = {
  downloading: 0,
  queued: 1,
  failed: 2,
  canceled: 2,
  exists: 3,
  done: 3,
}

export function DownloadProgressModal({
  downloadDir,
  downloadQueue,
  downloadProgress,
  activeFileNames,
  setDownloadProgress,
  setDownloading,
  onFileDownloaded,
  onQueueClear,
  onQueueShift,
  onRevealFile,
}: DownloadProgressModalProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef(downloadQueue)
  const fileSnapshotsRef = useRef<Map<string, LunaFile>>(new Map())
  const drainingRef = useRef(false)
  const onFileDownloadedRef = useRef(onFileDownloaded)
  const onQueueClearRef = useRef(onQueueClear)
  const onQueueShiftRef = useRef(onQueueShift)
  const readyThumbnailUrlsRef = useRef<Map<string, string>>(new Map())
  const [, forceUpdate] = useState(0)
  const requestedThumbnailIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    queueRef.current = downloadQueue
    for (const file of downloadQueue) {
      fileSnapshotsRef.current.set(file.name, file)
    }
  }, [downloadQueue])

  // 对下载队列中的文件主动请求缩略图缓存
  useEffect(() => {
    for (const file of downloadQueue) {
      if (file.thumbnailUrl || requestedThumbnailIdsRef.current.has(file.id)) continue
      requestedThumbnailIdsRef.current.add(file.id)
      window.luna.cacheFile(file).catch(() => {
        requestedThumbnailIdsRef.current.delete(file.id)
      })
    }
  }, [downloadQueue])

  // 监听缩略图就绪，动态更新缩略图
  useEffect(() => {
    return window.luna.onThumbnailReady(({ fileId, fileName, thumbnailUrl }) => {
      let updated = false
      for (const file of fileSnapshotsRef.current.values()) {
        if (file.id === fileId || file.name === fileName) {
          readyThumbnailUrlsRef.current.set(file.name, thumbnailUrl)
          updated = true
          break
        }
      }
      // 也尝试从 downloadQueue 匹配（snapshot 可能未及时更新）
      if (!updated) {
        for (const file of queueRef.current) {
          if (file.id === fileId || file.name === fileName) {
            readyThumbnailUrlsRef.current.set(file.name, thumbnailUrl)
            break
          }
        }
      }
      forceUpdate((n) => n + 1)
    })
  }, [])

  useEffect(() => {
    onFileDownloadedRef.current = onFileDownloaded
  }, [onFileDownloaded])

  useEffect(() => {
    onQueueClearRef.current = onQueueClear
  }, [onQueueClear])

  useEffect(() => {
    onQueueShiftRef.current = onQueueShift
  }, [onQueueShift])

  const MAX_CONCURRENT = 5

  async function downloadFile(file: LunaFile, downloadDir: string): Promise<void> {
    setDownloadProgress((current) => {
      const next = new Map(current)
      const existing = next.get(file.name)
      if (existing?.status !== 'done' && existing?.status !== 'exists') {
        next.set(file.name, {
          fileName: file.name,
          index: existing?.index ?? 0,
          totalFiles: existing?.totalFiles ?? queueRef.current.length,
          downloaded: existing?.downloaded ?? 0,
          total: existing?.total ?? file.bytes,
          percent: existing?.percent ?? 0,
          speedBps: 0,
          status: 'downloading',
        })
      }
      return next
    })

    try {
      const summary = await window.luna.downloadFiles([file], downloadDir)
      const completed = summary.completed.find((item) => item.name === file.name)
      if (completed) onFileDownloadedRef.current(file.name, completed.path)
    } catch (error) {
      console.error(error)
      setDownloadProgress((current) => {
        const next = new Map(current)
        next.set(file.name, {
          fileName: file.name,
          index: 0,
          totalFiles: 1,
          downloaded: 0,
          total: file.bytes,
          percent: null,
          speedBps: 0,
          status: 'failed',
        })
        return next
      })
    } finally {
      queueRef.current = queueRef.current.filter((item) => item.name !== file.name)
      onQueueShiftRef.current(file.name)
    }
  }

  useEffect(() => {
    async function drainQueue(): Promise<void> {
      if (!downloadDir || drainingRef.current || queueRef.current.length === 0) return

      drainingRef.current = true
      setDownloading(true)
      try {
        while (queueRef.current.length > 0) {
          // 过滤掉已完成或已存在的项
          queueRef.current = queueRef.current.filter((item) => {
            const p = downloadProgress.get(item.name)
            return p?.status !== 'done' && p?.status !== 'exists'
          })

          // 取最多 MAX_CONCURRENT 个文件并发下载
          const batch = queueRef.current.slice(0, MAX_CONCURRENT)
          if (batch.length === 0) break

          await Promise.all(batch.map((file) => downloadFile(file, downloadDir!)))
        }
      } finally {
        drainingRef.current = false
        setDownloading(false)
      }
    }

    void drainQueue()
  })

  const entries = [...activeFileNames]
    .map((fileName) => downloadProgress.get(fileName))
    .filter((progress): progress is DownloadProgress => Boolean(progress))
    .sort((a, b) => {
    const statusOrder = statusRank[a.status] - statusRank[b.status]
    return statusOrder || a.index - b.index || a.fileName.localeCompare(b.fileName)
  })
  const totalCount = entries.length
  const completedCount = entries.filter((p) => p.status === 'done' || p.status === 'exists').length
  const failedCount = entries.filter((p) => p.status === 'failed').length
  const canceledCount = entries.filter((p) => p.status === 'canceled').length
  const activeCount = entries.filter((p) => p.status === 'downloading').length
  const queuedCount = entries.filter((p) => p.status === 'queued').length

  const totalBytes = entries.reduce((s, p) => s + (p.total ?? 0), 0)
  const downloadedBytes = entries.reduce((s, p) => s + p.downloaded, 0)
  const overallPercent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0

  if (totalCount === 0) return null

  async function cancelDownloads(): Promise<void> {
    queueRef.current = []
    onQueueClearRef.current()
    setDownloadProgress((current) => {
      const next = new Map(current)
      for (const [fileName, progress] of next.entries()) {
        if (progress.status === 'queued') {
          next.delete(fileName)
          continue
        }
        if (progress.status === 'downloading') {
          next.set(fileName, {
            ...progress,
            status: 'canceled',
            speedBps: 0,
          })
        }
      }
      return next
    })
    setDownloading(false)
    await window.luna.cancelDownloads()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* 下载进度徽标 */}
      <button
        className={`download-badge ${activeCount > 0 ? 'is-active' : ''} ${failedCount > 0 ? 'has-failed' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={activeCount > 0 ? `下载中 (${activeCount})` : `${completedCount} 个已完成`}
      >
        {activeCount > 0 ? (
          <Loader2 className="spin" size={16} />
        ) : failedCount > 0 ? (
          <X size={14} />
        ) : canceledCount > 0 ? (
          <X size={14} />
        ) : (
          <Check size={14} />
        )}
        <span className="download-badge-count">
          {completedCount}/{totalCount}
        </span>
        <span className="download-badge-pct">{Math.round(overallPercent)}%</span>
      </button>

      {/* 下载进度下拉面板 */}
      <DropdownPanel
        open={open}
        triggerRef={rootRef}
        onClose={() => setOpen(false)}
        title={<><Download size={16} />下载进度</>}
        headerActions={activeCount + queuedCount > 0 && (
          <Button variant="secondary" size="compact" className="dl-cancel-button" onClick={() => void cancelDownloads()} icon={<X size={14} />}>
            取消
          </Button>
        )}
      >
        {/* 总进度 */}
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
            <div className="dl-overall-fill" style={{ width: `${overallPercent}%` }} />
          </div>
        </div>

        {/* 文件列表 */}
        <div className="dl-file-list">
          {entries.map((progress) => {
            const file = fileSnapshotsRef.current.get(progress.fileName)
            const previewSource = previewSourceFor(progress, file, readyThumbnailUrlsRef.current)
            const isVideoPreview = file?.kind === 'video' || file?.kind === 'lrv'
            const pct = progress.status === 'done' || progress.status === 'exists'
              ? 100
              : progress.total ? (progress.downloaded / progress.total) * 100 : 0
            const normalizedStatus = progress.status === 'exists' ? 'done' : progress.status
            return (
              <div key={progress.fileName} className={`dl-file-item ${normalizedStatus}`}>
                <div className="dl-file-preview">
                  {previewSource && !isVideoPreview && <img src={previewSource} alt="" loading="lazy" />}
                  {previewSource && isVideoPreview && <video src={previewSource} muted playsInline preload="metadata" />}
                  {!previewSource && <FileQuestion size={18} />}
                </div>
                <div className="dl-file-info">
                  <span className="dl-file-name">{progress.fileName}</span>
                  <span className="dl-file-meta">
                    {formatBytes(progress.downloaded)}
                    {progress.total ? ` / ${formatBytes(progress.total)}` : ''}
                    {progress.speedBps > 0 && ` · ${formatSpeed(progress.speedBps)}`}
                    {(progress.status === 'done' || progress.status === 'exists') && ' · 已完成'}
                    {progress.status === 'queued' && ' · 等待中'}
                    {progress.status === 'failed' && ' · 失败'}
                    {progress.status === 'canceled' && ' · 已取消'}
                  </span>
                  <div className="dl-file-progress-track">
                    <div className="dl-file-progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
                <div className="dl-file-actions">
                  {(progress.status === 'done' || progress.status === 'exists') && progress.destinationPath && (
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
      </DropdownPanel>
    </div>
  )
}

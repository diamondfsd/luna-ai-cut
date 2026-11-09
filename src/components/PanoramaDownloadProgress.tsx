import { useState } from 'react'
import { LoaderCircle, RefreshCw, X } from 'lucide-react'

import type { PanoramaDownloadProgress as Progress } from '../shared/types'
import { Button } from '../ui'
import '../styles/panorama-download-progress.css'

interface PanoramaDownloadProgressProps {
  progress: Progress
  onCancel: () => Promise<void>
  onRetry?: () => void
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function PanoramaDownloadProgress({ progress, onCancel, onRetry }: PanoramaDownloadProgressProps) {
  const [cancelPending, setCancelPending] = useState(false)
  const isDownloading = progress.status === 'downloading' || progress.status === 'photo-complete'
  const overallPercent = progress.status === 'complete'
    ? 100
    : Math.min(100, ((progress.completedPhotos + (progress.status === 'downloading' ? (progress.percent ?? 0) / 100 : 0)) / progress.totalPhotos) * 100)
  const title = progress.status === 'complete'
    ? '下载完成'
    : progress.status === 'starting'
      ? '准备下载'
      : progress.status === 'cancelled'
        ? '下载已取消'
        : progress.status === 'failed'
          ? '下载失败'
          : '正在下载'
  const currentPhoto = progress.status === 'photo-complete'
    ? `已完成第 ${progress.slot + 1} 张`
    : `第 ${progress.slot + 1} 张`

  return (
    <section className="panorama-download-progress">
      <div className="panorama-download-progress-heading">
        <strong>{title}</strong>
        <span>{progress.completedPhotos}/{progress.totalPhotos} 张</span>
      </div>
      <div
        className="panorama-download-progress-track"
        role="progressbar"
        aria-label="全景照片下载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(overallPercent)}
      >
        <span style={{ width: `${overallPercent}%` }} />
      </div>
      {progress.status !== 'complete' && (
        <div className="panorama-download-progress-details">
          <span>{currentPhoto}{progress.status === 'downloading' && progress.percent !== null ? ` · ${Math.round(progress.percent)}%` : ''}</span>
          {progress.total !== null && <span>{formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span>}
        </div>
      )}
      {progress.error && <p className="panorama-download-progress-error">{progress.error}</p>}
      <div className="panorama-download-progress-actions">
        {isDownloading && (
          <Button
            variant="secondary"
            size="compact"
            icon={cancelPending ? <LoaderCircle className="is-spinning" size={14} /> : <X size={14} />}
            disabled={cancelPending}
            onClick={() => {
              setCancelPending(true)
              void onCancel().catch(() => undefined).finally(() => setCancelPending(false))
            }}
          >
            取消下载
          </Button>
        )}
        {(progress.status === 'failed' || progress.status === 'cancelled') && onRetry && (
          <Button variant="secondary" size="compact" icon={<RefreshCw size={14} />} onClick={onRetry}>
            重试下载
          </Button>
        )}
      </div>
    </section>
  )
}

import { useState } from 'react'
import { Download, X } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { overallDownloadProgress } from '../lib/downloadProgress'
import { useDownloadProgress } from '../context/DownloadProgressContext'
import { Button } from '../ui'
import '../styles/download-progress.css'

interface GlobalDownloadProgressProps {
  visible: boolean
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} KB/s`
  return `${Math.round(bps)} B/s`
}

export function GlobalDownloadProgress({ visible }: GlobalDownloadProgressProps) {
  const { downloadProgress, cancelDownloads } = useDownloadProgress()
  const [canceling, setCanceling] = useState(false)
  const entries = [...downloadProgress.values()]
    .filter((progress) => progress.status === 'queued' || progress.status === 'downloading')
    .sort((a, b) => a.index - b.index || a.fileName.localeCompare(b.fileName))

  if (!visible || entries.length === 0) return null

  const overallPercent = overallDownloadProgress(entries)
  const totalBytes = entries.reduce((sum, progress) => sum + (progress.total ?? 0), 0)
  const downloadedBytes = entries.reduce((sum, progress) => sum + progress.downloaded, 0)
  const speedBps = entries.reduce((sum, progress) => sum + progress.speedBps, 0)
  const current = entries.find((progress) => progress.status === 'downloading') ?? entries[0]

  async function handleCancel(): Promise<void> {
    if (canceling) return
    setCanceling(true)
    try {
      await cancelDownloads()
    } catch (error) {
      console.error('取消下载失败', error)
    } finally {
      setCanceling(false)
    }
  }

  return (
    <div className="global-download-progress" role="status" aria-live="polite">
      <div className="global-download-progress-row">
        <Download size={16} aria-hidden="true" />
        <div className="global-download-progress-info">
          <strong>正在下载 {entries.length} 个文件</strong>
          <span>
            {current.fileName} · {formatBytes(downloadedBytes)}
            {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ''}
            {speedBps > 0 ? ` · ${formatSpeed(speedBps)}` : ''}
          </span>
        </div>
        <span className="global-download-progress-percent">{Math.round(overallPercent)}%</span>
        <Button
          variant="secondary"
          size="compact"
          disabled={canceling}
          icon={<X size={14} />}
          onClick={() => void handleCancel()}
        >
          {canceling ? '取消中...' : '取消'}
        </Button>
      </div>
      <div className="global-download-progress-track">
        <div className="global-download-progress-fill" style={{ width: `${overallPercent}%` }} />
      </div>
    </div>
  )
}

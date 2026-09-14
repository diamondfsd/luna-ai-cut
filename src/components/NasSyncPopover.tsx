import { CheckCircle2, CloudUpload, FolderCog, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatBytes } from '../lib/format'
import { useApp } from '../context/AppContext'
import { useNasSyncProgress } from '../context/NasSyncProgressContext'
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip, toast } from '../ui'
import '../styles/nas-sync-progress.css'

function statusLabel(state: string): string {
  switch (state) {
    case 'syncing': return '同步中'
    case 'error': return '有文件失败'
    case 'not-configured': return '未配置 NAS'
    default: return '已完成'
  }
}

function timeLabel(value: string | null): string {
  if (!value) return '暂无'
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function NasSyncPopover() {
  const { settings } = useApp()
  const { status, refresh } = useNasSyncProgress()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const enabled = settings?.nasSync?.enabled === true
  if (!enabled) return null

  const percent = Math.round(status.percent ?? 0)
  const hasPending = status.pendingFiles > 0
  const canRetry = status.failedFiles > 0 && status.state !== 'not-configured'

  async function retryFailed(): Promise<void> {
    try {
      const count = await window.luna.nasSync.retryFailed()
      await refresh()
      if (count > 0) toast.success(`已重新加入 ${count} 个文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试失败')
    }
  }

  async function cancelPending(): Promise<void> {
    try {
      await window.luna.nasSync.cancelPending()
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消失败')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="查看 NAS 同步">
        <PopoverTrigger asChild>
          <span className="nas-sync-nav-trigger">
            <IconButton
              variant="ghost"
              size="mini"
              icon={<CloudUpload size={15} />}
              aria-label="查看 NAS 同步"
              title="查看 NAS 同步"
            />
            {(hasPending || status.failedFiles > 0) && <span className="nas-sync-nav-dot" />}
          </span>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="nas-sync-popover" align="end" sideOffset={8}>
        <div className="nas-sync-popover-header">
          <div>
            <strong>NAS 同步</strong>
            <span>{statusLabel(status.state)}</span>
          </div>
          <CloudUpload size={17} aria-hidden="true" />
        </div>

        {status.state === 'not-configured' ? (
          <div className="nas-sync-empty">
            <span>请先完成 NAS 配置</span>
            <Button variant="primary" size="compact" icon={<FolderCog size={14} />} onClick={() => { setOpen(false); navigate('/settings') }}>
              去设置
            </Button>
          </div>
        ) : (
          <>
            <div className="nas-sync-progress-summary">
              <div>
                <strong>{percent}%</strong>
                <span>{status.completedFiles} / {status.totalFiles} 个文件</span>
              </div>
              <span>{formatBytes(status.completedBytes)} / {formatBytes(status.totalBytes)}</span>
            </div>
            <div className="nas-sync-progress-track" aria-label={`NAS 同步进度 ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="nas-sync-current">
              <span>{status.currentFileName ?? (status.totalFiles > 0 ? '等待同步' : '暂无同步任务')}</span>
              {status.currentFileName && <span>{formatBytes(status.currentDownloadedBytes)} / {formatBytes(status.currentTotalBytes)}</span>}
            </div>
            <div className="nas-sync-meta">
              <span>速度 {formatBytes(status.speedBps)}/s</span>
              <span>失败 {status.failedFiles}</span>
              <span>上次 {timeLabel(status.lastSyncedAt)}</span>
            </div>
            {status.lastError && <div className="nas-sync-error">{status.lastError}</div>}
            {status.failedItems.length > 0 && (
              <div className="nas-sync-failed-list">
                {status.failedItems.slice(-3).map((item) => (
                  <div key={item.id}>
                    <span>{item.fileName}</span>
                    <small>{item.error}</small>
                  </div>
                ))}
              </div>
            )}
            <div className="nas-sync-actions">
              <Button variant="secondary" size="compact" disabled={!canRetry} icon={<RefreshCw size={14} />} onClick={() => void retryFailed()}>
                重试失败
              </Button>
              <Button variant="secondary" size="compact" disabled={!hasPending} icon={<X size={14} />} onClick={() => void cancelPending()}>
                取消待同步
              </Button>
            </div>
          </>
        )}
        <div className="nas-sync-popover-footer">
          <span>{status.remotePath ?? '未设置目标'}</span>
          {status.state === 'ready' && status.completedFiles > 0 && <CheckCircle2 size={14} aria-hidden="true" />}
        </div>
      </PopoverContent>
    </Popover>
  )
}

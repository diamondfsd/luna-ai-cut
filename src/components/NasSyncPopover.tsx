import { AlertCircle, CheckCircle2, Clock3, CloudUpload, FolderCog, Loader2, RefreshCw, X, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { formatBytes } from '../lib/format'
import { useApp } from '../context/AppContext'
import { useNasSyncProgress } from '../context/NasSyncProgressContext'
import type { NasSyncFileStatus } from '../shared/types'
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

function createdAtLabel(value: number | null): string {
  if (!value) return '未知创建时间'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function taskStateLabel(state: NasSyncFileStatus['state']): string {
  switch (state) {
    case 'syncing': return '同步中'
    case 'failed': return '失败'
    case 'synced': return '已完成'
    case 'canceled': return '已取消'
    default: return '等待同步'
  }
}

function TaskStateIcon({ state }: { state: NasSyncFileStatus['state'] }) {
  switch (state) {
    case 'syncing': return <Loader2 className="nas-sync-task-spinner" size={14} aria-hidden="true" />
    case 'failed': return <AlertCircle size={14} aria-hidden="true" />
    case 'synced': return <CheckCircle2 size={14} aria-hidden="true" />
    case 'canceled': return <XCircle size={14} aria-hidden="true" />
    default: return <Clock3 size={14} aria-hidden="true" />
  }
}

function taskDetail(item: NasSyncFileStatus): string {
  if (item.state === 'failed') return item.error ?? '同步失败'
  if (item.state === 'syncing') {
    const percent = item.bytes && item.bytes > 0 ? Math.min(100, Math.round((item.downloadedBytes / item.bytes) * 100)) : 0
    return `${taskStateLabel(item.state)} ${percent}%`
  }
  return taskStateLabel(item.state)
}

export function NasSyncPopover() {
  const { settings } = useApp()
  const { status, refresh, progressPopoverOpen, setProgressPopoverOpen } = useNasSyncProgress()
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
    <Popover open={progressPopoverOpen} onOpenChange={setProgressPopoverOpen}>
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
            <Button variant="primary" size="compact" icon={<FolderCog size={14} />} onClick={() => { setProgressPopoverOpen(false); navigate('/settings') }}>
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
            <div className="nas-sync-meta">
              <span>速度 {formatBytes(status.speedBps)}/s</span>
              <span>失败 {status.failedFiles}</span>
              <span>上次 {timeLabel(status.lastSyncedAt)}</span>
            </div>
            {status.lastError && <div className="nas-sync-error">{status.lastError}</div>}
            <div className="nas-sync-task-list-header">
              <span>待完成</span>
              <span>
                {status.pendingItemsTruncated
                  ? `显示 ${status.pendingItems.length} / ${status.pendingFiles + status.failedFiles}`
                  : status.pendingItems.length}
              </span>
            </div>
            <div className="nas-sync-task-list" role="list" aria-label="NAS 待完成文件">
              {status.pendingItems.length > 0 ? status.pendingItems.map((item) => (
                <div className={`nas-sync-task is-${item.state}`} role="listitem" key={item.id}>
                  <span className="nas-sync-task-icon"><TaskStateIcon state={item.state} /></span>
                  <div className="nas-sync-task-copy">
                    <span title={item.fileName}>{item.fileName}</span>
                    <small title={item.targetPath}>{item.targetPath} · {createdAtLabel(item.sourceCreatedAtMs)}</small>
                  </div>
                  <span className="nas-sync-task-detail" title={taskDetail(item)}>{taskDetail(item)}</span>
                </div>
              )) : (
                <div className="nas-sync-task-empty">暂无待同步文件</div>
              )}
            </div>
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

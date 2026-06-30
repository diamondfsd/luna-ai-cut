import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, FileDown, Film, ImageIcon, Loader2, X, XCircle } from 'lucide-react'

import type { ExportTaskRecord, LunaFile } from '../shared/types'
import { useApp } from '../context/AppContext'
import { Button, Dialog, IconButton } from '../ui'
import { filePathToPreviewUrl } from './previewModalUtils'
import { PreviewModal } from './PreviewModal'
import '../styles/export-tasks.css'

function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}分${seconds}秒`
}

/* ==================== 任务明细弹窗 ==================== */

interface ExportTaskDetailDialogProps {
  task: ExportTaskRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRevealFile?: (path: string) => void
}

function ExportTaskDetailDialog({ task, open, onOpenChange, onRevealFile, onPreviewItem }: ExportTaskDetailDialogProps & { onPreviewItem?: (item: ExportTaskRecord['items'][number]) => void }) {
  if (!task) return null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`任务明细 — ${task.name}`}
      className="et-detail-dialog"
    >
      <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
        共 <strong style={{ color: 'var(--ink)' }}>{task.totalCount}</strong> 个文件
        ，开始于 {formatDate(task.startTime)}
        {task.duration !== null && `，总耗时 ${formatDuration(task.duration)}`}
      </p>
      <div className="et-table-wrap">
        <table className="et-table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>类型</th>
              <th>开始时间</th>
              <th>完成时间</th>
              <th>耗时</th>
              <th>进度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {task.items.map((item) => {
              const pct = item.status === 'done' ? 100 : item.progress
              const isVideo = item.kind === 'video' || item.kind === 'lrv'
              return (
                <tr key={item.exportId} className={`et-row et-status-${item.status}`}>
                  <td>
                    <span className="et-cell-name">
                      {item.status === 'exporting' && <Loader2 className="spin" size={13} style={{ flexShrink: 0 }} />}
                      {item.status === 'done' && <CheckCircle2 size={13} style={{ flexShrink: 0, color: '#34c759' }} />}
                      {item.status === 'failed' && <XCircle size={13} style={{ flexShrink: 0, color: '#ff3b30' }} />}
                      {item.status === 'queued' && <Clock size={13} style={{ flexShrink: 0, color: 'var(--muted)' }} />}
                      {item.status === 'canceled' && <span style={{ flexShrink: 0, fontSize: 13 }}>⏹️</span>}
                      <span className="et-item-name">{item.fileName}</span>
                    </span>
                  </td>
                  <td className="et-cell-num">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {isVideo ? <Film size={13} /> : <ImageIcon size={13} />}
                      {isVideo ? '视频' : '图片'}
                    </span>
                  </td>
                  <td className="et-cell-time">{formatTime(item.startTime)}</td>
                  <td className="et-cell-time">{formatTime(item.endTime)}</td>
                  <td className="et-cell-num">{formatDuration(item.duration)}</td>
                  <td>
                    <div className="et-progress-inline">
                      <span className="et-progress-track" style={{ width: 48 }}>
                        <span className="et-progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      <span className="et-cell-num">{Math.round(pct)}%</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {(item.status === 'exporting' || item.status === 'queued') && (
                        <span className={`et-badge et-badge-${item.status}`}>
                          {item.status === 'exporting' ? '导出中' : '等待中'}
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="et-badge et-badge-failed">{item.error ?? '失败'}</span>
                      )}
                      {item.status === 'canceled' && (
                        <span className="et-badge et-badge-canceled">已取消</span>
                      )}
                      {item.status === 'done' && item.destinationPath && (
                        <>
                          <IconButton variant="ghost" onClick={() => onPreviewItem?.(item)} title="预览" icon={<Eye size={14} />} />
                          <IconButton variant="ghost" onClick={() => onRevealFile?.(item.destinationPath!)} title="在文件夹中显示" icon={<FileDown size={14} />} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}

/* ==================== 导出任务表格 ==================== */

interface ExportTaskTableProps {
  onRevealFile?: (path: string) => void
}

export function ExportTaskTable({ onRevealFile }: ExportTaskTableProps) {
  const { exporting } = useApp()
  const [tasks, setTasks] = useState<ExportTaskRecord[]>([])
  const PAGE_SIZE = 10
  const [loading, setLoading] = useState(false)
  const [detailTask, setDetailTask] = useState<ExportTaskRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [previewFile, setPreviewFile] = useState<LunaFile | null>(null)

  const loadTasks = async () => {
    setLoading(true)
    try {
      const result = await window.luna.getExportTasks()
      setTasks(result)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadTasks() }, [])
  useEffect(() => {
    if (!exporting) return
    void loadTasks()
    const interval = setInterval(() => { void loadTasks() }, 2000)
    return () => clearInterval(interval)
  }, [exporting])

  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageTasks = tasks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // 导出进行中时翻回第一页
  useEffect(() => {
    if (exporting) setPage(1)
  }, [exporting])

  const handlePreviewItem = (item: ExportTaskRecord['items'][number]): void => {
    if (!item.destinationPath) return
    const destUrl = filePathToPreviewUrl(item.destinationPath) ?? ''
    setPreviewFile({
      id: item.exportId,
      name: item.destinationPath.split(/[/\\]/).pop() ?? item.fileName,
      href: item.fileName,
      sourceUrl: destUrl,
      url: destUrl,
      dateText: '',
      timeText: '',
      sizeText: '',
      bytes: null,
      kind: item.kind as 'image' | 'video',
      extension: '',
      capturedAt: null,
      groupDay: '',
      groupHour: '',
      videoKey: null,
      previewName: null,
      previewUrl: null,
      cacheFilePath: null,
      downloadFilePath: item.destinationPath,
      thumbnailUrl: null,
      isLivePhoto: false,
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: item.fileName,
      canPreview: true,
      localPath: item.destinationPath,
    })
  }

  const handleCancelTask = async (taskId: string): Promise<void> => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return {
          ...t,
          status: 'canceled' as const,
          progress: 0,
          items: t.items.map((item) =>
            item.status === 'queued' || item.status === 'exporting'
              ? { ...item, status: 'canceled' as const, progress: 0, endTime: Date.now(), duration: 0 }
              : item,
          ),
        }
      }),
    )
    await window.luna.cancelExportTask(taskId)
  }

  if (loading && tasks.length === 0) {
    return (
      <div className="et-loading">
        <Loader2 className="spin" size={16} />
        <span>加载中...</span>
      </div>
    )
  }

  return (
    <>
      <div className="et-table-wrap">
        <table className="et-table">
          <thead>
            <tr>
              <th>任务名称</th>
              <th>数量</th>
              <th>开始时间</th>
              <th>完成时间</th>
              <th>耗时</th>
              <th>进度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="et-empty">暂无导出记录</td>
              </tr>
            ) : pageTasks.map((task) => {
              const done = task.items.filter((i) => i.status === 'done').length
              const failed = task.items.filter((i) => i.status === 'failed').length
              return (
                <tr key={task.id} className={`et-row et-status-${task.status}`}>
                  <td>
                    <span className="et-cell-name">
                      {task.status === 'exporting' && <Loader2 className="spin" size={14} style={{ flexShrink: 0 }} />}
                      {task.status === 'completed' && <CheckCircle2 size={14} style={{ flexShrink: 0, color: '#34c759' }} />}
                      {task.status === 'failed' && <XCircle size={14} style={{ flexShrink: 0, color: '#ff3b30' }} />}
                      {task.status === 'canceled' && <span style={{ flexShrink: 0, fontSize: 14 }}>⏹️</span>}
                      {(task.status === 'pending' || task.status === 'exporting') && <Clock size={14} style={{ flexShrink: 0, color: 'var(--blue)' }} />}
                      <span className="et-item-name">{task.name}</span>
                    </span>
                  </td>
                  <td className="et-cell-num">
                    {done}/{task.totalCount}
                    {failed > 0 && <span style={{ color: '#ff3b30', marginLeft: 4, fontSize: 12 }}>({failed})</span>}
                  </td>
                  <td className="et-cell-time">{formatDate(task.startTime)}</td>
                  <td className="et-cell-time">{task.endTime ? formatDate(task.endTime) : '—'}</td>
                  <td className="et-cell-num">{task.status === 'exporting' ? '进行中...' : formatDuration(task.duration)}</td>
                  <td>
                    <div className="et-progress-bar">
                      <span className="et-progress-track">
                        <span className={`et-progress-fill et-fill-${task.status}`} style={{ width: `${Math.min(100, task.progress)}%` }} />
                      </span>
                      <span className="et-cell-num" style={{ fontSize: 12 }}>
                        {task.progress}%
                        {task.status === 'exporting' && <Loader2 className="spin" size={10} style={{ marginLeft: 2 }} />}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {(task.status === 'exporting' || task.status === 'pending') && (
                        <IconButton variant="ghost" icon={<X size={12} />} onClick={() => void handleCancelTask(task.id)} title="取消导出" />
                      )}
                      <Button variant="ghost" size="mini" icon={<Eye size={12} />} onClick={() => { setDetailTask(task); setDetailOpen(true) }}>
                        查看
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="et-pagination">
          <button className="et-page-btn" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft size={14} />
          </button>
          <span className="et-page-info">{safePage} / {totalPages}</span>
          <button className="et-page-btn" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      <ExportTaskDetailDialog task={detailTask} open={detailOpen} onOpenChange={setDetailOpen} onRevealFile={onRevealFile} onPreviewItem={handlePreviewItem} />
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
          onReveal={(f) => onRevealFile?.(f.downloadFilePath ?? f.localPath ?? '')}
          onFileChange={setPreviewFile}
        />
      )}
    </>
  )
}

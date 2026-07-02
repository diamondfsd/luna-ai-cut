import { useEffect, useState } from 'react'
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon, Clock, Eye, FileDown, Film, ImageIcon, Loader2, X, XCircle } from 'lucide-react'

import type { ExportTaskRecord, ExportTaskItemRecord, LunaFile } from '../shared/types'
import { useApp } from '../context/AppContext'
import { IconButton } from '../ui'
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}分${seconds}秒`
}

/* ==================== 导出任务表格（可展开式） ==================== */

interface ExportTaskTableProps {
  onRevealFile?: (path: string) => void
}

export function ExportTaskTable({ onRevealFile }: ExportTaskTableProps) {
  const { exporting } = useApp()
  const [tasks, setTasks] = useState<ExportTaskRecord[]>([])
  const PAGE_SIZE = 10
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
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

  // 首次加载或 tasks 变化时，默认展开最近的一个导出任务
  useEffect(() => {
    if (tasks.length > 0) {
      setExpandedTasks(new Set([tasks[0].id]))
    }
  }, [tasks.length > 0 ? tasks[0].id : null])

  useEffect(() => {
    if (expandedTasks.size === 0 && tasks.length > 0) {
      setExpandedTasks(new Set([tasks[0].id]))
    }
  }, [tasks.length])

  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageTasks = tasks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // 导出进行中时翻回第一页
  useEffect(() => {
    if (exporting) setPage(1)
  }, [exporting])

  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handlePreviewItem = (item: ExportTaskItemRecord): void => {
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
              <th style={{ width: 32 }}></th>
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
                <td colSpan={8} className="et-empty">暂无导出记录</td>
              </tr>
            ) : pageTasks.map((task) => {
              const done = task.items.filter((i) => i.status === 'done').length
              const failed = task.items.filter((i) => i.status === 'failed').length
              const isExpanded = expandedTasks.has(task.id)
              const hasExpandable = task.items.length > 0
              return (
                <tr key={task.id} className={`et-row et-status-${task.status}`}>
                  <td style={{ textAlign: 'center' }}>
                    {hasExpandable && (
                      <button className="et-expand-btn" onClick={() => toggleExpand(task.id)} title={isExpanded ? '收起' : '展开'}>
                        <ChevronRightIcon size={14} style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }} />
                      </button>
                    )}
                  </td>
                  <td>
                    <span className="et-cell-name">
                      {task.status === 'exporting' && <Loader2 className="spin" size={14} style={{ flexShrink: 0 }} />}
                      {task.status === 'completed' && <CheckCircle2 size={14} style={{ flexShrink: 0, color: '#34c759' }} />}
                      {task.status === 'failed' && <XCircle size={14} style={{ flexShrink: 0, color: '#ff3b30' }} />}
                      {task.status === 'canceled' && <Ban size={14} style={{ flexShrink: 0, color: 'var(--muted)' }} />}
                      {(task.status === 'pending' || task.status === 'exporting') && <Clock size={14} style={{ flexShrink: 0, color: 'var(--blue)' }} />}
                      <span className="et-item-name">{task.name}</span>
                    </span>
                    {isExpanded && (
                      <div className="et-task-items">
                        {task.items.map((item) => (
                          <div key={item.exportId} className={`et-task-item et-status-${item.status}`}>
                            <span className="et-ti-icon">
                              {item.status === 'exporting' && <Loader2 className="spin" size={12} />}
                              {item.status === 'done' && <CheckCircle2 size={12} style={{ color: '#34c759' }} />}
                              {item.status === 'failed' && <XCircle size={12} style={{ color: '#ff3b30' }} />}
                              {item.status === 'queued' && <Clock size={12} style={{ color: 'var(--muted)' }} />}
                              {item.status === 'canceled' && <Ban size={12} style={{ color: 'var(--muted)' }} />}
                            </span>
                            <span className="et-ti-kind">
                              {item.kind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
                            </span>
                            <span className="et-ti-name">{item.fileName}</span>
                            <span className="et-ti-time">{formatTime(item.startTime)}</span>
                            <span className="et-ti-dur">{formatDuration(item.duration)}</span>
                            <span className="et-ti-progress">
                              <span className="et-progress-track" style={{ width: 40 }}>
                                <span className="et-progress-fill" style={{ width: `${Math.min(100, item.status === 'done' ? 100 : item.progress)}%` }} />
                              </span>
                              <span className="et-cell-num">{item.status === 'done' ? 100 : Math.round(item.progress)}%</span>
                            </span>
                            <span className="et-ti-actions">
                              {item.status === 'failed' && (
                                <span className="et-badge et-badge-failed">{item.error ?? '失败'}</span>
                              )}
                              {item.status === 'done' && item.destinationPath && (
                                <>
                                  <IconButton variant="ghost" onClick={() => handlePreviewItem(item)} title="预览" icon={<Eye size={13} />} />
                                  <IconButton variant="ghost" onClick={() => onRevealFile?.(item.destinationPath!)} title="在文件夹中显示" icon={<FileDown size={13} />} />
                                </>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
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

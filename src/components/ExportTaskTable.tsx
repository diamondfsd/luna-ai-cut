import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Eye, FileDown, Film, ImageIcon, Loader2, X, XCircle } from 'lucide-react'

import type { ExportTaskItemRecord, ExportTaskRecord } from '../shared/types'
import { showPreviewModal } from './previewModalService'
import { useApp } from '../context/AppContext'
import { Dialog, IconButton, toast } from '../ui'
import { Table, type Column } from '../ui/Table'
import '../styles/export-tasks.css'

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

function formatETA(item: ExportTaskItemRecord): string | null {
  if (item.status !== 'exporting' || !item.startTime || item.progress <= 0) return null
  const now = Date.now()
  const elapsed = now - item.startTime
  if (elapsed < 1000) return null
  const progress = item.progress / 100
  const estimatedTotal = elapsed / progress
  const remaining = estimatedTotal - elapsed
  if (remaining < 0 || !Number.isFinite(remaining)) return null
  return formatDuration(Math.round(remaining))
}

/* ==================== 内联项目条 ==================== */

function TaskItemRow({ item, onPreview, onRevealFile }: {
  item: ExportTaskItemRecord
  onPreview: (item: ExportTaskItemRecord) => void
  onRevealFile?: (path: string) => void
}) {
  const isVideo = item.kind === 'video' || item.kind === 'lrv'
  const [errorDialogOpen, setErrorDialogOpen] = useState(false)
  // 导出后的文件名：优先用 destinationPath，回退到 fileName
  const displayName = item.destinationPath
    ? item.destinationPath.split(/[/\\]/).pop() ?? item.fileName
    : item.fileName
  return (
    <div className={`et-task-item et-status-${item.status}`}>
      <span className="et-ti-icon">
        {item.status === 'exporting' && <Loader2 className="spin" size={12} />}
        {item.status === 'done' && <CheckCircle2 size={12} style={{ color: '#34c759' }} />}
        {item.status === 'failed' && <XCircle size={12} style={{ color: '#ff3b30' }} />}
        {item.status === 'queued' && <Clock size={12} style={{ color: 'var(--muted)' }} />}
        {item.status === 'canceled' && <Ban size={12} style={{ color: 'var(--muted)' }} />}
      </span>
      <span className="et-ti-kind">{isVideo ? <Film size={12} /> : <ImageIcon size={12} />}{isVideo ? ' 视频' : ' 图片'}</span>
      <span className="et-ti-name" title={item.destinationPath ?? item.fileName}>{displayName}</span>
      <span className="et-ti-dur">{formatDuration(item.duration)}</span>
      <span className="et-ti-progress">
        <span className="et-progress-track" style={{ width: 40 }}>
          <span className="et-progress-fill" style={{ width: `${Math.min(100, item.status === 'done' ? 100 : item.progress)}%` }} />
        </span>
        <span className="et-cell-num">{item.status === 'done' ? 100 : Math.round(item.progress)}%</span>
      </span>
      <span className="et-ti-eta">{item.status === 'exporting' ? formatETA(item) : null}</span>
      <span className="et-ti-actions">
        {item.status === 'failed' && (
          <button className="et-badge et-badge-failed" onClick={() => setErrorDialogOpen(true)} title="点击查看错误详情" style={{ cursor: 'pointer', border: 'none' }}>
            失败
          </button>
        )}
        {item.status === 'done' && item.destinationPath && (
          <>
            <IconButton variant="ghost" onClick={() => onPreview(item)} title="预览" icon={<Eye size={13} />} />
            <IconButton variant="ghost" onClick={() => onRevealFile?.(item.destinationPath!)} title="在文件夹中显示" icon={<FileDown size={13} />} />
          </>
        )}
      </span>

      {errorDialogOpen && (
        <Dialog
          open={errorDialogOpen}
          onOpenChange={setErrorDialogOpen}
          title="导出错误详情"
          className="et-detail-dialog"
        >
          <pre style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5, background: 'var(--bg-subtle)', padding: 12, borderRadius: 8, fontFamily: 'monospace', margin: '0 0 12px' }}>
            {item.error ?? '未知错误'}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="ui-btn ui-btn-primary"
              onClick={() => { navigator.clipboard.writeText(item.error ?? '未知错误').catch(() => {}); toast.success('已复制') }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '4px 12px' }}
            >
              <Copy size={14} />
              复制
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

/* ==================== 导出任务表格 ==================== */

interface ExportTaskTableProps {
  onRevealFile?: (path: string) => void
}

export function ExportTaskTable({ onRevealFile }: ExportTaskTableProps) {
  const { exportProgress, exporting } = useApp()
  const [tasks, setTasks] = useState<ExportTaskRecord[]>([])
  const PAGE_SIZE = 10
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  // 任务级错误详情弹窗
  const [taskErrorDialog, setTaskErrorDialog] = useState<{ task: ExportTaskRecord; errorText: string } | null>(null)

  const loadTasks = async () => {
    setLoading(true)
    try {
      const result = await window.luna.exportTask.list()
      setTasks(result)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadTasks() }, [])
  useEffect(() => {
    if (exportProgress.size === 0) return
    void loadTasks()
  }, [exportProgress])
  const prevExportingRef = useRef(exporting)
  useEffect(() => {
    if (!exporting) return
    void loadTasks()
    const interval = setInterval(() => { void loadTasks() }, 2000)
    return () => clearInterval(interval)
  }, [exporting])
  // 导出刚结束时再做一次加载，确保表格显示最终状态
  useEffect(() => {
    if (prevExportingRef.current && !exporting) {
      void loadTasks()
    }
    prevExportingRef.current = exporting
  }, [exporting])

  // 默认展开最近的一个导出任务
  useEffect(() => {
    if (tasks.length > 0 && expandedTasks.size === 0) {
      setExpandedTasks(new Set([tasks[0].id]))
    }
  }, [tasks.length])

  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageTasks = tasks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (exporting) setPage(1)
  }, [exporting])

  const handlePreviewItem = (item: ExportTaskItemRecord): void => {
    if (!item.destinationPath) return
    const task = tasks.find((t) => t.items.some((i) => i.id === item.id))
    if (!task) return
    const filePaths = task.items
      .filter((i) => i.destinationPath && i.status === 'done')
      .map((i) => i.destinationPath!)
    if (filePaths.length === 0) return
    showPreviewModal(item.destinationPath, filePaths, true)
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
    await window.luna.exportTask.cancel(taskId)
  }

  const statusIcon = (task: ExportTaskRecord) => {
    if (task.status === 'exporting') return <Loader2 className="spin" size={14} style={{ flexShrink: 0 }} />
    if (task.status === 'completed') return <CheckCircle2 size={14} style={{ flexShrink: 0, color: '#34c759' }} />
    if (task.status === 'failed') return <XCircle size={14} style={{ flexShrink: 0, color: '#ff3b30' }} />
    if (task.status === 'canceled') return <Ban size={14} style={{ flexShrink: 0, color: 'var(--muted)' }} />
    return <Clock size={14} style={{ flexShrink: 0, color: 'var(--blue)' }} />
  }

  const columns: Column<ExportTaskRecord>[] = [
    {
      key: 'name',
      label: '任务名称',
      render: (task) => (
        <span className="et-cell-name">
          {statusIcon(task)}
          <span className="et-item-name">{task.name}</span>
        </span>
      ),
    },
    {
      key: 'count',
      label: '数量',
      width: 60,
      className: 'et-cell-num',
      render: (task) => {
        const done = task.items.filter((i) => i.status === 'done').length
        const failed = task.items.filter((i) => i.status === 'failed').length
        return (
          <>{done}/{task.totalCount}{failed > 0 && <span style={{ color: '#ff3b30', marginLeft: 4, fontSize: 12 }}>({failed})</span>}</>
        )
      },
    },
    {
      key: 'startTime',
      label: '开始时间',
      className: 'et-cell-time',
      render: (task) => formatDate(task.startTime),
    },
    {
      key: 'endTime',
      label: '完成时间',
      className: 'et-cell-time',
      render: (task) => task.endTime ? formatDate(task.endTime) : '—',
    },
    {
      key: 'duration',
      label: '耗时',
      className: 'et-cell-num',
      render: (task) => task.status === 'exporting' ? '进行中...' : formatDuration(task.duration),
    },
    {
      key: 'progress',
      label: '进度',
      render: (task) => (
        <div className="et-progress-bar">
          <span className="et-progress-track">
            <span className={`et-progress-fill et-fill-${task.status}`} style={{ width: `${Math.min(100, task.progress)}%` }} />
          </span>
          <span className="et-cell-num" style={{ fontSize: 12 }}>
            {task.progress}%
            {task.status === 'exporting' && <Loader2 className="spin" size={10} style={{ marginLeft: 2 }} />}
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      render: (task) => {
        const failedItems = task.items.filter((i) => i.status === 'failed')
        return (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(task.status === 'exporting' || task.status === 'pending') && (
              <IconButton variant="ghost" icon={<X size={12} />} onClick={() => void handleCancelTask(task.id)} title="取消导出" />
            )}
            {failedItems.length > 0 && (
              <IconButton
                variant="ghost"
                icon={<AlertCircle size={13} style={{ color: '#ff3b30' }} />}
                onClick={() => {
                  const lines = failedItems.map((item) => {
                    const name = item.fileName
                    const err = item.error ?? '未知错误'
                    return `【${name}】\n${err}`
                  })
                  setTaskErrorDialog({ task, errorText: lines.join('\n\n---\n\n') })
                }}
                title={`${failedItems.length} 个文件导出失败，点击查看详情`}
              />
            )}
          </div>
        )
      },
    },
  ]

  const rowClassName = (task: ExportTaskRecord) => `et-row et-status-${task.status}`

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
      <Table
        columns={columns}
        data={pageTasks}
        keyExtractor={(task) => task.id}
        emptyLabel="暂无导出记录"
        rowClassName={rowClassName}
        expandContent={(task) => (
          <div className="et-task-items" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            {task.items.map((item) => (
              <TaskItemRow key={item.id} item={item} onPreview={handlePreviewItem} onRevealFile={onRevealFile} />
            ))}
          </div>
        )}
        expandedKeys={expandedTasks}
        onExpandToggle={(expandKey) => {
          setExpandedTasks((prev) => {
            const next = new Set(prev)
            if (next.has(expandKey)) next.delete(expandKey)
            else next.add(expandKey)
            return next
          })
        }}
      />

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

      {taskErrorDialog && (
        <Dialog
          open={!!taskErrorDialog}
          onOpenChange={(open) => { if (!open) setTaskErrorDialog(null) }}
          title={`导出错误详情 - ${taskErrorDialog.task.name}`}
          className="et-detail-dialog"
        >
          <pre style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5, background: 'var(--bg-subtle)', padding: 12, borderRadius: 8, fontFamily: 'monospace', margin: '0 0 12px' }}>
            {taskErrorDialog.errorText}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="ui-btn ui-btn-primary"
              onClick={() => { navigator.clipboard.writeText(taskErrorDialog.errorText).catch(() => {}); toast.success('已复制') }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '4px 12px' }}
            >
              <Copy size={14} />
              复制错误日志
            </button>
          </div>
        </Dialog>
      )}

    </>
  )
}

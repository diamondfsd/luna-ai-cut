import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Eye, FileDown, Loader2, Trash2, X, XCircle } from 'lucide-react'

import type { ExportTaskRecord } from '../shared/types'
import { useApp } from '../context/AppContext'
import { Button, Dialog, IconButton } from '../ui'
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

function ExportTaskDetailDialog({ task, open, onOpenChange, onRevealFile }: ExportTaskDetailDialogProps) {
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
              <th>开始时间</th>
              <th>完成时间</th>
              <th>耗时</th>
              <th>进度</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {task.items.map((item) => {
              const pct = item.status === 'done' ? 100 : item.progress
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
                    {item.status === 'done' && item.destinationPath ? (
                      <IconButton variant="ghost" onClick={() => onRevealFile?.(item.destinationPath!)} title="在文件夹中显示" icon={<FileDown size={14} />} />
                    ) : (
                      <span className={`et-badge et-badge-${item.status}`}>
                        {item.status === 'exporting' ? '导出中' : ''}
                        {item.status === 'queued' ? '等待中' : ''}
                        {item.status === 'failed' ? (item.error ? item.error : '失败') : ''}
                        {item.status === 'canceled' ? '已取消' : ''}
                      </span>
                    )}
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
  const [loading, setLoading] = useState(false)
  const [detailTask, setDetailTask] = useState<ExportTaskRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

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
    void loadTasks() // 立即刷新，不等 2s
    const interval = setInterval(() => { void loadTasks() }, 2000)
    return () => clearInterval(interval)
  }, [exporting])

  const handleCancelTask = async (taskId: string): Promise<void> => {
    // 立即乐观更新本地状态，让按钮消失
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

  const handleClear = async () => {
    await window.luna.clearExportTasks()
    setTasks([])
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
      {tasks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button variant="ghost" size="mini" icon={<Trash2 size={12} />} onClick={() => void handleClear()}>
            清空记录
          </Button>
        </div>
      )}
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
            ) : tasks.map((task) => {
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

      <ExportTaskDetailDialog task={detailTask} open={detailOpen} onOpenChange={setDetailOpen} onRevealFile={onRevealFile} />
    </>
  )
}

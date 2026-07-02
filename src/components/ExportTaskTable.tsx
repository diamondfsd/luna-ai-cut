import { useEffect, useState } from 'react'
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, FileDown, Film, ImageIcon, Loader2, X, XCircle } from 'lucide-react'

import type { ExportTaskItemRecord, ExportTaskRecord, LunaFile } from '../shared/types'
import { useApp } from '../context/AppContext'
import { IconButton } from '../ui'
import { Table, type Column } from '../ui/Table'
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

/* ==================== 内联项目条 ==================== */

function TaskItemRow({ item, onPreview, onRevealFile }: {
  item: ExportTaskItemRecord
  onPreview: (item: ExportTaskItemRecord) => void
  onRevealFile?: (path: string) => void
}) {
  const isVideo = item.kind === 'video' || item.kind === 'lrv'
  return (
    <div className={`et-task-item et-status-${item.status}`}>
      <span className="et-ti-icon">
        {item.status === 'exporting' && <Loader2 className="spin" size={12} />}
        {item.status === 'done' && <CheckCircle2 size={12} style={{ color: '#34c759' }} />}
        {item.status === 'failed' && <XCircle size={12} style={{ color: '#ff3b30' }} />}
        {item.status === 'queued' && <Clock size={12} style={{ color: 'var(--muted)' }} />}
        {item.status === 'canceled' && <Ban size={12} style={{ color: 'var(--muted)' }} />}
      </span>
      <span className="et-ti-kind">{isVideo ? <Film size={12} /> : <ImageIcon size={12} />}</span>
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
        {item.status === 'failed' && <span className="et-badge et-badge-failed">{item.error ?? '失败'}</span>}
        {item.status === 'done' && item.destinationPath && (
          <>
            <IconButton variant="ghost" onClick={() => onPreview(item)} title="预览" icon={<Eye size={13} />} />
            <IconButton variant="ghost" onClick={() => onRevealFile?.(item.destinationPath!)} title="在文件夹中显示" icon={<FileDown size={13} />} />
          </>
        )}
      </span>
    </div>
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
      render: (task) => (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(task.status === 'exporting' || task.status === 'pending') && (
            <IconButton variant="ghost" icon={<X size={12} />} onClick={() => void handleCancelTask(task.id)} title="取消导出" />
          )}
        </div>
      ),
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
              <TaskItemRow key={item.exportId} item={item} onPreview={handlePreviewItem} onRevealFile={onRevealFile} />
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

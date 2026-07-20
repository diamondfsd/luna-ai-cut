import { useState } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'

import { ThumbImage } from '../components/ThumbImage'
import type { AiSelectionPreset, AiSelectionPurpose, AiSelectionSession, AiSelectionSource, AiSelectionTarget } from '../shared/types'
import { Button, Dialog, IconButton } from '../ui'
import { AiSelectionCreateDialog } from './AiSelectionCreateDialog'

interface AiSelectionTaskPickerProps {
  sessions: AiSelectionSession[]
  loading: boolean
  busy: boolean
  onOpenTask: (id: string) => void
  onCreateTask: (source: AiSelectionSource, name?: string, options?: { preset: AiSelectionPreset; purpose: AiSelectionPurpose; target: AiSelectionTarget }) => Promise<void>
  onRemoveTask: (id: string) => Promise<void>
}

function statusText(session: AiSelectionSession): string {
  if (session.status === 'analyzing' && session.phase === 'photos') return '正在整理照片'
  if (session.status === 'analyzing' && session.phase === 'videos') return '照片可选，视频整理中'
  return ({
    queued: '等待整理',
    indexing: '正在添加素材',
    analyzing: '正在整理',
    paused: '已暂停',
    interrupted: '可继续',
    ready: '可以选片',
    completed: '已创建项目',
    failed: '整理失败',
    canceled: '已取消',
  } as Record<string, string>)[session.status] ?? session.status
}

function sessionPreviewPaths(session: AiSelectionSession): string[] {
  const itemPaths = session.items.map((item) => item.path)
  return (itemPaths.length > 0 ? itemPaths : session.source.paths ?? []).slice(0, 4)
}

export function AiSelectionTaskPicker({ sessions, loading, busy, onOpenTask, onCreateTask, onRemoveTask }: AiSelectionTaskPickerProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTask, setDeleteTask] = useState<AiSelectionSession | null>(null)

  return (
    <div className="ai-selection-task-page">
      <header className="ai-selection-task-header">
        <div><h2>AI 选片任务</h2><span>{loading ? '加载中…' : `${sessions.length} 个任务`}</span></div>
        <Button variant="primary" size="compact" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>新建选片任务</Button>
      </header>
      <div className="ai-selection-task-grid">
        {sessions.map((item) => {
          const previewPaths = sessionPreviewPaths(item)
          return <article key={item.id} className="ai-selection-task-card">
            <button type="button" className="ai-selection-task-open" onClick={() => onOpenTask(item.id)}>
              <span className="ai-selection-task-cover">
                {previewPaths.length > 0 ? previewPaths.map((filePath) => <ThumbImage key={filePath} src={filePath} alt="" draggable={false} />) : <Sparkles size={34} />}
              </span>
              <strong>{item.name}</strong>
              <span>{statusText(item)} · {item.items.length || item.counts.total} 个素材 · 已保留 {item.counts.kept}</span>
            </button>
            <IconButton variant="ghost" size="mini" className="ai-selection-task-delete" icon={<Trash2 size={14} />} aria-label={`删除 ${item.name}`} title="删除任务" onClick={() => setDeleteTask(item)} />
          </article>
        })}
        {!loading && sessions.length === 0 && <div className="ai-selection-task-empty"><Sparkles size={34} /><h3>还没有选片任务</h3><Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>新建选片任务</Button></div>}
      </div>

      <AiSelectionCreateDialog open={createOpen} busy={busy} onOpenChange={setCreateOpen} onCreate={onCreateTask} />
      <Dialog
        open={Boolean(deleteTask)}
        onOpenChange={(open) => !open && setDeleteTask(null)}
        title={deleteTask ? `删除「${deleteTask.name}」` : '删除选片任务'}
        description="只删除可重新生成的整理结果，不会删除或移动原始照片和视频。"
        footer={<><Button variant="secondary" onClick={() => setDeleteTask(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => { if (deleteTask) void onRemoveTask(deleteTask.id).then(() => setDeleteTask(null)).catch(() => undefined) }}>删除任务</Button></>}
      />
    </div>
  )
}

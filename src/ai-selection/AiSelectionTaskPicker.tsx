import { useEffect, useMemo, useState } from 'react'
import { Check, FolderOpen, Images, Import, Plus, Sparkles, Trash2 } from 'lucide-react'

import { ThumbImage } from '../components/ThumbImage'
import type { AiSelectionSession, AiSelectionSource, LunaFile } from '../shared/types'
import { Button, ButtonGroup, Dialog, IconButton, Input, SearchField, toast } from '../ui'

type SourceMode = 'local' | 'files' | 'directory'

interface AiSelectionTaskPickerProps {
  sessions: AiSelectionSession[]
  loading: boolean
  busy: boolean
  onOpenTask: (id: string) => void
  onCreateTask: (source: AiSelectionSource, name?: string) => Promise<void>
  onRemoveTask: (id: string) => Promise<void>
}

function sourcePath(file: LunaFile): string {
  return file.localPath ?? file.downloadFilePath ?? file.cacheFilePath ?? ''
}

function pathName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? value
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
    completed: '已整理',
    failed: '整理失败',
    canceled: '已取消',
  } as Record<string, string>)[session.status] ?? session.status
}

function sessionPreviewPaths(session: AiSelectionSession): string[] {
  const itemPaths = session.items.map((item) => item.path)
  return (itemPaths.length > 0 ? itemPaths : session.source.paths ?? []).slice(0, 4)
}

function AiSelectionCreateDialog({ open, busy, onOpenChange, onCreate }: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (source: AiSelectionSource, name?: string) => Promise<void>
}) {
  const [sourceMode, setSourceMode] = useState<SourceMode>('local')
  const [taskName, setTaskName] = useState('')
  const [localFiles, setLocalFiles] = useState<LunaFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [importedPaths, setImportedPaths] = useState<string[]>([])
  const [directory, setDirectory] = useState('')
  const [search, setSearch] = useState('')
  const [loadingLocal, setLoadingLocal] = useState(false)

  useEffect(() => {
    if (!open) return
    setSourceMode('local')
    setTaskName('')
    setSelectedPaths(new Set())
    setImportedPaths([])
    setDirectory('')
    setSearch('')
    setLoadingLocal(true)
    void Promise.allSettled([window.luna.listDownloadedFiles(), window.luna.listExportFiles()]).then((results) => {
      const files = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      const unique = new Map<string, LunaFile>()
      for (const file of files) {
        const filePath = sourcePath(file)
        if (filePath && (file.kind === 'image' || file.kind === 'video')) unique.set(filePath, file)
      }
      setLocalFiles([...unique.values()])
      if (results.every((result) => result.status === 'rejected')) toast.error('本地资源暂时无法读取')
    }).finally(() => setLoadingLocal(false))
  }, [open])

  const visibleLocalFiles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return term ? localFiles.filter((file) => file.name.toLocaleLowerCase().includes(term)) : localFiles
  }, [localFiles, search])

  const source = useMemo<AiSelectionSource | null>(() => {
    if (sourceMode === 'local' && selectedPaths.size > 0) {
      const paths = [...selectedPaths]
      return { kind: 'files', label: `本地资源 ${paths.length} 个素材`, paths }
    }
    if (sourceMode === 'files' && importedPaths.length > 0) {
      return { kind: 'files', label: `导入 ${importedPaths.length} 个素材`, paths: importedPaths }
    }
    if (sourceMode === 'directory' && directory) {
      return { kind: 'directory', label: pathName(directory), directory }
    }
    return null
  }, [directory, importedPaths, selectedPaths, sourceMode])

  function toggleLocalPath(filePath: string): void {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  async function chooseFiles(): Promise<void> {
    const paths = await window.luna.aiSelection.chooseFiles()
    if (paths.length === 0) return
    setImportedPaths(paths)
    if (!taskName.trim()) setTaskName(`${pathName(paths[0]).replace(/\.[^.]+$/, '')} 等 ${paths.length} 个素材`)
  }

  async function chooseDirectory(): Promise<void> {
    const value = await window.luna.aiSelection.chooseDirectory()
    if (!value) return
    setDirectory(value)
    if (!taskName.trim()) setTaskName(`${pathName(value)} AI 选片`)
  }

  async function create(): Promise<void> {
    if (!source || busy) return
    try {
      await onCreate(source, taskName)
      onOpenChange(false)
    } catch {
      // The task hook reports the user-facing error and keeps this dialog open for retry.
    }
  }

  const selectedSourcePaths = sourceMode === 'files' ? importedPaths : []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建选片任务"
      description="从本地资源快速选择，或从电脑导入新的照片和视频。"
      className="ai-selection-create-dialog"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={!source || busy} icon={<Sparkles size={14} />} onClick={() => void create()}>{busy ? '创建中…' : '创建并开始整理'}</Button></>}
    >
      <div className="ai-selection-create-body">
        <label className="ai-selection-create-name"><span>任务名称</span><Input fullWidth value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder={source?.label ? `${source.label} AI 选片` : '选片任务名称（可选）'} /></label>
        <ButtonGroup
          className="ai-selection-source-tabs"
          value={sourceMode}
          onChange={setSourceMode}
          options={[{ value: 'local', label: '本地资源' }, { value: 'files', label: '从电脑导入' }, { value: 'directory', label: '选择文件夹' }]}
        />
        <p className="ai-selection-create-safe">只读取素材，不会移动或修改原文件；相似内容会自动放在一起，最终仍由你确认。</p>

        {sourceMode === 'local' && <section className="ai-selection-source-panel">
          <div className="ai-selection-source-toolbar">
            <SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索本地资源" />
            <span>{selectedPaths.size} 个已选</span>
            <Button variant="ghost" size="mini" disabled={visibleLocalFiles.length === 0} onClick={() => setSelectedPaths(new Set(visibleLocalFiles.map(sourcePath)))}>全选</Button>
            <Button variant="ghost" size="mini" disabled={selectedPaths.size === 0} onClick={() => setSelectedPaths(new Set())}>清空</Button>
          </div>
          {loadingLocal ? <div className="ai-selection-source-empty">正在读取本地资源…</div> : visibleLocalFiles.length === 0 ? <div className="ai-selection-source-empty">本地资源中还没有可选的照片或视频，也可以从电脑导入。</div> : <div className="ai-selection-source-grid">
            {visibleLocalFiles.map((file) => {
              const filePath = sourcePath(file)
              const selected = selectedPaths.has(filePath)
              return <button key={filePath} type="button" className={selected ? 'selected' : ''} onClick={() => toggleLocalPath(filePath)} title={file.name}>
                <ThumbImage src={filePath} alt="" draggable={false} />
                <span>{file.name}</span>
                {selected && <i><Check size={12} /></i>}
              </button>
            })}
          </div>}
        </section>}

        {sourceMode === 'files' && <section className="ai-selection-source-panel ai-selection-import-panel">
          <Import size={28} />
          <strong>{selectedSourcePaths.length > 0 ? `已选择 ${selectedSourcePaths.length} 个素材` : '选择照片和视频'}</strong>
          <span>{selectedSourcePaths.length > 0 ? selectedSourcePaths.map(pathName).slice(0, 3).join('、') : '可以一次选择多个文件，不会移动或修改原文件。'}</span>
          <Button variant="secondary" icon={<Images size={14} />} onClick={() => void chooseFiles()}>{selectedSourcePaths.length > 0 ? '重新选择' : '选择文件'}</Button>
        </section>}

        {sourceMode === 'directory' && <section className="ai-selection-source-panel ai-selection-import-panel">
          <FolderOpen size={28} />
          <strong>{directory ? pathName(directory) : '选择素材文件夹'}</strong>
          <span>{directory || '文件夹中的照片和视频会加入同一个选片任务。'}</span>
          <Button variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void chooseDirectory()}>{directory ? '重新选择' : '选择文件夹'}</Button>
        </section>}
      </div>
    </Dialog>
  )
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
              <span>{statusText(item)} · {item.items.length || item.counts.total} 个素材</span>
              <small>已选 {item.counts.selected} · 更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
            </button>
            <IconButton variant="ghost" size="mini" className="ai-selection-task-delete" icon={<Trash2 size={14} />} aria-label={`删除 ${item.name}`} title="删除任务" onClick={() => setDeleteTask(item)} />
          </article>
        })}
        {!loading && sessions.length === 0 && <div className="ai-selection-task-empty"><Sparkles size={34} /><h3>还没有选片任务</h3><p>从本地资源选择照片，或导入电脑中的素材开始整理。</p><Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>新建选片任务</Button></div>}
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

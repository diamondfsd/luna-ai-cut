import { useCallback, useEffect, useMemo, useState } from 'react'
import { Heart, MessageSquare, Plus, Save, Scissors, Tag } from 'lucide-react'

import type { AiEditorLocalMedia } from '../shared/types/aiEditor'
import type { FootageSelectionItem, FootageSelectionProject, FootageSelectionProjectSummary } from '../shared/types/aiEditing'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { Button, Select, Textarea, toast } from '../ui'

function blankItem(mediaId: string): FootageSelectionItem {
  return { mediaId, decision: 'undecided', comment: '', tags: [], points: [], ranges: [], updatedAt: null }
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function FootageSelectionPanel({ active }: { active: boolean }): JSX.Element {
  const [media, setMedia] = useState<AiEditorLocalMedia[]>([])
  const [projects, setProjects] = useState<FootageSelectionProjectSummary[]>([])
  const [project, setProject] = useState<FootageSelectionProject | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedMediaId, setSelectedMediaId] = useState('')
  const [previewPath, setPreviewPath] = useState('')
  const [playheadMs, setPlayheadMs] = useState(0)
  const [rangeStartMs, setRangeStartMs] = useState<number | null>(null)
  const [rangeEndMs, setRangeEndMs] = useState<number | null>(null)
  const [projectName, setProjectName] = useState('素材标注')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeItem = project?.items[selectedMediaId] ?? null
  const selectedMedia = useMemo(() => media.find(item => item.mediaId === selectedMediaId) ?? null, [media, selectedMediaId])

  const refresh = useCallback(async (): Promise<void> => {
    const [localMedia, list] = await Promise.all([
      window.luna.aiEditor.listLocalMedia({ limit: 500 }),
      window.luna.aiEditor.footageSelection.list(),
    ])
    setMedia(localMedia.filter(item => item.kind === 'video' || item.kind === 'image'))
    setProjects(list)
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh().catch(value => setError(value instanceof Error ? value.message : '素材读取失败'))
  }, [active, refresh])

  useEffect(() => {
    if (!active || !selectedMediaId) {
      setPreviewPath('')
      return
    }
    let cancelled = false
    void window.luna.aiEditor.getLocalMedia(selectedMediaId).then(item => {
      if (!cancelled) setPreviewPath(item.sourcePath ?? '')
    }).catch(value => {
      if (!cancelled) setError(value instanceof Error ? value.message : '素材预览读取失败')
    })
    return () => { cancelled = true }
  }, [active, selectedMediaId])

  async function openProject(id: string): Promise<void> {
    if (!id) { setProject(null); setSelectedMediaId(''); return }
    setBusy(true)
    try {
      const loaded = await window.luna.aiEditor.footageSelection.load(id)
      setProject(loaded)
      setSelectedMediaId(Object.keys(loaded.items)[0] ?? '')
      setDirty(false)
      setError('')
    } catch (value) {
      setError(value instanceof Error ? value.message : '标注项目读取失败')
    } finally { setBusy(false) }
  }

  async function createProject(): Promise<void> {
    if (selectedIds.size === 0) { setError('先从左侧选择素材'); return }
    setBusy(true)
    try {
      const created = await window.luna.aiEditor.footageSelection.create(projectName, [...selectedIds])
      setProject(created)
      setSelectedMediaId(Object.keys(created.items)[0] ?? '')
      setSelectedIds(new Set())
      setDirty(false)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : '标注项目创建失败')
    } finally { setBusy(false) }
  }

  function updateItem(next: FootageSelectionItem): void {
    if (!project) return
    setProject({ ...project, items: { ...project.items, [next.mediaId]: next } })
    setDirty(true)
  }

  async function save(): Promise<void> {
    if (!project || !dirty || busy) return
    setBusy(true)
    try {
      const saved = await window.luna.aiEditor.footageSelection.save(project, project.revision)
      setProject(saved)
      setDirty(false)
      setError('')
      await refresh()
      toast.success('标注已保存')
    } catch (value) {
      setError(value instanceof Error ? value.message : '标注保存失败')
    } finally { setBusy(false) }
  }

  async function addSelectedMedia(): Promise<void> {
    if (!project || selectedIds.size === 0 || busy) return
    setBusy(true)
    try {
      const items = { ...project.items }
      for (const id of selectedIds) if (!items[id]) items[id] = blankItem(id)
      const saved = await window.luna.aiEditor.footageSelection.save({ ...project, items }, project.revision)
      setProject(saved)
      setSelectedMediaId([...selectedIds][0] ?? selectedMediaId)
      setSelectedIds(new Set())
      setDirty(false)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : '素材加入失败')
    } finally { setBusy(false) }
  }

  function toggleSelected(id: string): void {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addPoint(): void {
    if (!activeItem) return
    updateItem({ ...activeItem, points: [...activeItem.points, {
      id: crypto.randomUUID(), timeMs: Math.round(playheadMs), liked: true, comment: '', updatedAt: new Date().toISOString(),
    }] })
  }

  function addRange(): void {
    if (!activeItem || rangeStartMs === null || rangeEndMs === null || rangeEndMs <= rangeStartMs) {
      setError('先标记有效的片段起止时间')
      return
    }
    updateItem({ ...activeItem, ranges: [...activeItem.ranges, {
      id: crypto.randomUUID(), startMs: Math.round(rangeStartMs), endMs: Math.round(rangeEndMs), comment: '', locked: false,
      updatedAt: new Date().toISOString(),
    }] })
    setRangeStartMs(null)
    setRangeEndMs(null)
    setError('')
  }

  return <section className="ai-edit-panel footage-selection-panel">
    <aside className="footage-library">
      <div className="footage-project-controls">
        <Select value={project?.id ?? 'none'} fullWidth disabled={busy} placeholder="选择标注项目"
          options={[{ value: 'none', label: '未选择项目' }, ...projects.map(item => ({ value: item.projectId, label: `${item.projectName} · ${item.annotatedCount}/${item.itemCount}` }))]}
          onValueChange={id => void openProject(id === 'none' ? '' : id)} />
        <div className="footage-project-create">
          <input value={projectName} aria-label="标注项目名称" onChange={event => setProjectName(event.target.value)} />
          <Button size="compact" disabled={busy || selectedIds.size === 0} icon={<Plus size={14} />} onClick={() => void (project ? addSelectedMedia() : createProject())}>
            {project ? '加入' : '新建'}
          </Button>
        </div>
      </div>
      <div className="footage-media-list">
        {media.map(item => {
          const inProject = Boolean(project?.items[item.mediaId])
          const chosen = selectedIds.has(item.mediaId)
          return <div key={item.mediaId} className={`footage-media-row${selectedMediaId === item.mediaId ? ' active' : ''}`}>
            <button type="button" className="footage-media-open" onClick={() => setSelectedMediaId(item.mediaId)}>
              <span className="footage-media-kind">{item.kind === 'video' ? 'VIDEO' : item.kind.toUpperCase()}</span>
              <span className="footage-media-copy"><strong>{item.name}</strong><small>{item.capturedAt ? new Date(item.capturedAt).toLocaleString() : item.groupDay}</small></span>
              {inProject && <span className={`footage-decision-dot ${project?.items[item.mediaId]?.decision ?? ''}`} />}
            </button>
            <button type="button" className={`footage-select-toggle${chosen ? ' selected' : ''}`} aria-label={chosen ? '取消选择' : '选择素材'} onClick={() => toggleSelected(item.mediaId)}>{chosen ? '✓' : '+'}</button>
          </div>
        })}
        {media.length === 0 && <p className="footage-empty">本地资源中暂无照片或视频</p>}
      </div>
    </aside>

    <div className="footage-review">
      {!project ? <div className="footage-empty-state">选择素材后创建标注项目</div> : !activeItem || !selectedMedia ? <div className="footage-empty-state">项目里还没有素材</div> : <>
        <div className="footage-preview">
          {previewPath && selectedMedia.kind === 'video'
            ? <video src={filePathToPreviewUrl(previewPath) ?? undefined} controls onTimeUpdate={event => setPlayheadMs(event.currentTarget.currentTime * 1000)} />
            : previewPath ? <img src={filePathToPreviewUrl(previewPath) ?? undefined} alt={selectedMedia.name} /> : <span>正在读取素材</span>}
        </div>
        <div className="footage-review-head">
          <strong>{selectedMedia.name}</strong>
          <div className="footage-decision-actions">
            <Button size="compact" variant={activeItem.decision === 'liked' ? 'primary' : 'secondary'} icon={<Heart size={14} />}
              onClick={() => updateItem({ ...activeItem, decision: activeItem.decision === 'liked' ? 'undecided' : 'liked' })}>点赞</Button>
            <Button size="compact" variant={activeItem.decision === 'rejected' ? 'danger' : 'secondary'} onClick={() => updateItem({ ...activeItem, decision: activeItem.decision === 'rejected' ? 'undecided' : 'rejected' })}>不采用</Button>
          </div>
        </div>
        <label className="footage-field"><span><MessageSquare size={14} />整体评论</span>
          <Textarea value={activeItem.comment} rows={2} maxLength={2000} onChange={event => updateItem({ ...activeItem, comment: event.target.value })} placeholder="记录画面内容或剪辑想法" />
        </label>
        <label className="footage-field"><span><Tag size={14} />标签</span>
          <input value={activeItem.tags.join(', ')} onChange={event => updateItem({ ...activeItem, tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) })} placeholder="用逗号分隔" />
        </label>
        {selectedMedia.kind === 'video' && <div className="footage-mark-tools">
          <div><span>播放位置</span><strong>{clock(playheadMs)}</strong></div>
          <Button size="mini" onClick={addPoint}>点赞此刻</Button>
          <Button size="mini" onClick={() => setRangeStartMs(playheadMs)}>设为片段起点</Button>
          <Button size="mini" onClick={() => setRangeEndMs(playheadMs)}>设为片段终点</Button>
          <Button size="mini" icon={<Scissors size={13} />} onClick={addRange}>保存好片段</Button>
          <small>起点 {rangeStartMs === null ? '—' : clock(rangeStartMs)} · 终点 {rangeEndMs === null ? '—' : clock(rangeEndMs)}</small>
        </div>}
        <div className="footage-annotations">
          {activeItem.points.map(point => <div key={point.id} className="footage-annotation-row">
            <button type="button" onClick={() => setPlayheadMs(point.timeMs)}>{clock(point.timeMs)}</button>
            <input aria-label="时间点评论" value={point.comment} placeholder="时间点评论" onChange={event => updateItem({ ...activeItem, points: activeItem.points.map(item => item.id === point.id ? { ...item, comment: event.target.value } : item) })} />
            <button type="button" aria-label="移除时间点" onClick={() => updateItem({ ...activeItem, points: activeItem.points.filter(item => item.id !== point.id) })}>×</button>
          </div>)}
          {activeItem.ranges.map(range => <div key={range.id} className="footage-annotation-row">
            <button type="button" onClick={() => setPlayheadMs(range.startMs)}>{clock(range.startMs)}–{clock(range.endMs)}</button>
            <input aria-label="片段评论" value={range.comment} placeholder="片段评论" onChange={event => updateItem({ ...activeItem, ranges: activeItem.ranges.map(item => item.id === range.id ? { ...item, comment: event.target.value } : item) })} />
            <label className="footage-lock"><input type="checkbox" checked={range.locked} onChange={event => updateItem({ ...activeItem, ranges: activeItem.ranges.map(item => item.id === range.id ? { ...item, locked: event.target.checked } : item) })} />锁定</label>
            <button type="button" aria-label="移除片段" onClick={() => updateItem({ ...activeItem, ranges: activeItem.ranges.filter(item => item.id !== range.id) })}>×</button>
          </div>)}
        </div>
        <div className="footage-save-row">
          {error && <span role="alert">{error}</span>}
          <Button variant="primary" disabled={!dirty || busy} icon={<Save size={14} />} onClick={() => void save()}>{busy ? '保存中…' : '保存标注'}</Button>
        </div>
      </>}
    </div>
  </section>
}

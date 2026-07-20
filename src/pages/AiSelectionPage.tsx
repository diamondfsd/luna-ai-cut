import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Film, Grid2X2, Images, Layers3, Pause, Play, Redo2, Settings2, Sparkles, Square, Undo2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AiMediaThumb } from '../ai-selection/AiMediaThumb'
import { AiSelectionTaskPicker } from '../ai-selection/AiSelectionTaskPicker'
import { isReviewItem, matchesResultFilter, matchesSelectionSearch, stateLabel, type AiSelectionResultFilter } from '../ai-selection/aiSelectionView'
import { useAiSelection } from '../ai-selection/useAiSelection'
import { showPreviewModal } from '../components/previewModalService'
import type { AiSelectionItem, AiSelectionPurpose, AiSelectionState, AiSelectionTarget } from '../shared/types'
import { Button, ButtonGroup, Dialog, IconButton, Input, SearchField, Select, Tooltip, toast } from '../ui'
import '../styles/ai-selection.css'

type SelectionStage = 'overview' | 'scenes' | 'compare' | 'review'

function statusLabel(status: string, phase?: string): string {
  if (status === 'analyzing' && phase === 'photos') return '正在整理照片'
  if (status === 'analyzing' && phase === 'videos') return '视频整理中'
  return ({ queued: '等待整理', indexing: '正在添加素材', analyzing: '正在整理素材', paused: '已暂停', interrupted: '可以继续', ready: '可以开始选片', completed: '已创建项目', failed: '整理失败', canceled: '已取消' } as Record<string, string>)[status] ?? status
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function formatShootingPeriod(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const date = `${start.getMonth() + 1}月${start.getDate()}日`
  const clock = (value: Date): string => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  if (start.toDateString() !== end.toDateString()) return `${date} ${clock(start)} - ${end.getMonth() + 1}月${end.getDate()}日 ${clock(end)}`
  return clock(start) === clock(end) ? `${date} ${clock(start)}` : `${date} ${clock(start)} - ${clock(end)}`
}

function selectionReason(item: AiSelectionItem, purpose: AiSelectionPurpose): string {
  if (item.recommendationReason) return item.recommendationReason
  if (item.kind === 'video' && purpose !== 'editing') return '当前选片用途不自动推荐视频'
  if (item.kind === 'video' && item.videoSegments.length === 0) return '尚未分析视频内容'
  if (item.state === 'kept') return '已由你保留'
  if (item.state === 'rejected') return '已由你排除'
  return '未进入当前推荐范围'
}

export function AiSelectionPage() {
  const selection = useAiSelection()
  const { sessions, session, busy, loadingSessions, selectSession, closeSession, startTask, removeSession, controls } = selection
  const [stage, setStage] = useState<SelectionStage>('overview')
  const [focusedId, setFocusedId] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [filter, setFilter] = useState<AiSelectionResultFilter>('recommended')
  const [search, setSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const navigate = useNavigate()

  const items = useMemo(() => session?.items ?? [], [session?.items])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const groupsByItem = useMemo(() => new Map(session?.groups.flatMap((group) => group.itemIds.map((id) => [id, group] as const)) ?? []), [session?.groups])
  const activeScene = session?.scenes.find((scene) => scene.id === sceneId) ?? session?.scenes.find((scene) => scene.confirmation !== 'confirmed') ?? session?.scenes[0] ?? null
  const pendingGroups = useMemo(() => session?.groups.filter((group) => group.confirmation !== 'confirmed' && group.itemIds.length > 1) ?? [], [session?.groups])
  const activeGroup = session?.groups.find((group) => group.id === groupId) ?? pendingGroups[0] ?? null
  const searchedItems = useMemo(() => items.filter((item) => matchesSelectionSearch(item, search)), [items, search])
  const visibleItems = useMemo(() => {
    if (stage === 'scenes') {
      const sceneItems = searchedItems.filter((item) => activeScene?.itemIds.includes(item.id))
      const visibleIds = new Set(sceneItems.map((item) => item.id))
      return sceneItems.filter((item) => {
        const group = groupsByItem.get(item.id)
        if (!group) return true
        return group.itemIds.find((id) => visibleIds.has(id)) === item.id
      })
    }
    if (stage === 'compare') return searchedItems.filter((item) => activeGroup?.itemIds.includes(item.id))
    if (stage === 'review') return searchedItems.filter((item) => matchesResultFilter(item, filter))
    return searchedItems
  }, [activeGroup?.itemIds, activeScene?.itemIds, filter, groupsByItem, searchedItems, stage])
  const focused = itemsById.get(focusedId) ?? visibleItems[0] ?? null
  const running = session?.status === 'indexing' || session?.status === 'analyzing' || session?.status === 'queued'
  const percent = session?.counts.total ? Math.round(session.counts.completed / session.counts.total * 100) : 0
  const countSceneStacks = (itemIds: string[]): number => new Set(itemIds.map((id) => groupsByItem.get(id)?.id ?? id)).size

  async function createProject(): Promise<void> {
    if (!session) return
    try {
      const project = await window.luna.aiSelection.createWorkspaceProject(session.id, session.name)
      navigate('/workspace', { state: { project, initialIndex: 0 } })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  function setItemState(item: AiSelectionItem, state: AiSelectionState): void {
    void controls.apply({ type: 'set-state', itemId: item.id, state })
  }

  function openPreview(item: AiSelectionItem): void {
    const paths = visibleItems.map((candidate) => candidate.path)
    showPreviewModal(item.path, paths.length ? paths : [item.path], true, {
      onFilePathChange: (filePath) => {
        const next = items.find((candidate) => candidate.path === filePath)
        if (next) setFocusedId(next.id)
      },
    })
  }

  function selectStage(next: SelectionStage): void {
    setStage(next)
    setFocusedId('')
    if (next === 'scenes' && activeScene) setSceneId(activeScene.id)
    if (next === 'compare' && activeGroup) setGroupId(activeGroup.id)
  }

  function confirmCurrentScene(): void {
    if (!session || !activeScene) return
    const index = session.scenes.findIndex((scene) => scene.id === activeScene.id)
    const next = session.scenes.slice(index + 1).find((scene) => scene.confirmation !== 'confirmed')
      ?? session.scenes.slice(0, index).find((scene) => scene.confirmation !== 'confirmed')
    void controls.apply({ type: 'confirm-scene', sceneId: activeScene.id })
    if (next) setSceneId(next.id)
    setFocusedId('')
  }

  function confirmCurrentGroup(): void {
    if (!session || !activeGroup) return
    const index = pendingGroups.findIndex((group) => group.id === activeGroup.id)
    const next = pendingGroups[index + 1] ?? pendingGroups[0]
    void controls.apply({ type: 'confirm-group', groupId: activeGroup.id })
    if (next && next.id !== activeGroup.id) setGroupId(next.id)
    setFocusedId('')
  }

  function selectAdjacent(direction: -1 | 1): void {
    if (visibleItems.length === 0) return
    const index = Math.max(0, visibleItems.findIndex((item) => item.id === focused?.id))
    setFocusedId(visibleItems[(index + direction + visibleItems.length) % visibleItems.length].id)
  }

  useEffect(() => {
    setStage('overview'); setSearch(''); setFocusedId(''); setSceneId(''); setGroupId('')
  }, [session?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]') || !focused) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); selectAdjacent(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); selectAdjacent(1) }
      else if (event.key.toLowerCase() === 'p') { event.preventDefault(); setItemState(focused, 'kept') }
      else if (event.key.toLowerCase() === 'x') { event.preventDefault(); setItemState(focused, 'rejected') }
      else if (event.key.toLowerCase() === 'a') { event.preventDefault(); setItemState(focused, 'alternative') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!session) return <section className="ai-selection-page"><AiSelectionTaskPicker sessions={sessions} loading={loadingSessions} busy={busy} onOpenTask={(id) => void selectSession(id)} onCreateTask={startTask} onRemoveTask={removeSession} /></section>

  const stages: Array<{ id: SelectionStage; label: string; icon: typeof Images; count?: number }> = [
    { id: 'overview', label: '分析概览', icon: Grid2X2 },
    { id: 'scenes', label: '拍摄时段', icon: Images, count: session.scenes.filter((scene) => scene.confirmation !== 'confirmed').length },
    { id: 'compare', label: '精准比较', icon: Layers3, count: pendingGroups.length },
    { id: 'review', label: '全局复核', icon: CheckCircle2, count: session.counts.attention },
  ]
  const filters: Array<{ id: AiSelectionResultFilter; label: string; count: number }> = [
    { id: 'recommended', label: '推荐', count: items.filter((item) => matchesResultFilter(item, 'recommended')).length },
    { id: 'attention', label: '待确认', count: items.filter((item) => matchesResultFilter(item, 'attention')).length },
    { id: 'kept', label: '已保留', count: session.counts.kept },
    { id: 'rejected', label: '已排除', count: session.counts.rejected },
    { id: 'all', label: '全部', count: session.counts.total },
  ]

  return <section className="ai-selection-page"><div className="ai-selection-layout">
    <aside className="ai-selection-sidebar">
      <div className="ai-selection-sidebar-scroll">
        <Button variant="ghost" size="compact" icon={<ArrowLeft size={15} />} onClick={closeSession}>任务列表</Button>
        <div className="ai-selection-sidebar-heading"><Sparkles size={18} /><strong>{session.name}</strong></div>
        <div className="ai-selection-sidebar-status">{statusLabel(session.status, session.phase)} · {session.counts.completed}/{session.counts.total || '—'}</div>
        {running && <div className="ai-selection-progress" aria-label={`整理进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
        <nav className="ai-selection-stage-nav" aria-label="选片流程">{stages.map((entry) => {
          const Icon = entry.icon
          return <Button key={entry.id} variant="ghost" size="compact" className={stage === entry.id ? 'active' : ''} icon={<Icon size={15} />} onClick={() => selectStage(entry.id)}><span>{entry.label}</span>{entry.count !== undefined && <strong>{entry.count}</strong>}</Button>
        })}</nav>

        {stage === 'scenes' && <div className="ai-selection-sidebar-list">{session.scenes.map((scene) => { const label = formatShootingPeriod(scene.startAt, scene.endAt); return <Button key={scene.id} variant="ghost" size="compact" className={activeScene?.id === scene.id ? 'active' : ''} title={label} onClick={() => { setSceneId(scene.id); setFocusedId('') }}><span>{label}</span><strong>{countSceneStacks(scene.itemIds)}</strong></Button> })}</div>}
        {stage === 'compare' && <div className="ai-selection-sidebar-list">{pendingGroups.map((group, index) => <Button key={group.id} variant="ghost" size="compact" className={activeGroup?.id === group.id ? 'active' : ''} onClick={() => { setGroupId(group.id); setFocusedId('') }}><span>相似组 {index + 1}</span><strong>{group.itemIds.length}</strong></Button>)}</div>}
        {stage === 'review' && <div className="ai-selection-sidebar-list">{filters.map((entry) => <Button key={entry.id} variant="ghost" size="compact" className={filter === entry.id ? 'active' : ''} onClick={() => { setFilter(entry.id); setFocusedId('') }}><span>{entry.label}</span><strong>{entry.count}</strong></Button>)}</div>}

        <div className="ai-selection-sidebar-search"><SearchField fullWidth value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索素材" /></div>
        <section className="ai-selection-sidebar-section">
          <Button variant="secondary" size="compact" icon={<Settings2 size={14} />} onClick={() => setSettingsOpen(true)}>选片设置</Button>
          <div className="ai-selection-sidebar-controls">
            {running ? <Button variant="secondary" size="compact" icon={<Pause size={14} />} onClick={controls.pause}>暂停</Button> : !['ready', 'completed'].includes(session.status) && <Button variant="secondary" size="compact" icon={<Play size={14} />} onClick={controls.resume}>继续</Button>}
            {!['ready', 'completed'].includes(session.status) && <Button variant="ghost" size="compact" icon={<Square size={12} />} onClick={controls.cancel}>取消</Button>}
          </div>
          <div className="ai-selection-sidebar-history"><Tooltip content="撤销"><IconButton variant="ghost" size="compact" icon={<Undo2 size={15} />} aria-label="撤销" disabled={!session.canUndo} onClick={controls.undo} /></Tooltip><Tooltip content="重做"><IconButton variant="ghost" size="compact" icon={<Redo2 size={15} />} aria-label="重做" disabled={!session.canRedo} onClick={controls.redo} /></Tooltip></div>
        </section>

        {focused && <section className="ai-selection-sidebar-section ai-selection-current-item">
          <strong className="ai-selection-current-name" title={focused.name}>{focused.name}</strong>
          <div className="ai-selection-current-status"><strong>{stateLabel(focused.state)}</strong><span>{selectionReason(focused, session.purpose)}</span></div>
          <div className="ai-selection-state-actions"><Button variant={focused.state === 'kept' ? 'primary' : 'secondary'} size="compact" icon={<Check size={14} />} onClick={() => setItemState(focused, 'kept')}>保留素材</Button><Button variant={focused.state === 'rejected' ? 'danger' : 'secondary'} size="compact" icon={<X size={14} />} onClick={() => setItemState(focused, 'rejected')}>排除素材</Button></div>
          {focused.kind === 'video' && <div className="ai-selection-video-actions"><Button variant="secondary" size="compact" icon={<Play size={14} />} onClick={() => openPreview(focused)}>预览视频</Button>{focused.videoKeyframes.length === 0 && <Button variant="secondary" size="compact" icon={<Film size={14} />} disabled={busy || focused.analysisState !== 'ready'} onClick={() => void controls.analyzeVideos([focused.id])}>分析视频内容</Button>}</div>}
          {focused.videoSegments.length > 0 && <div className="ai-selection-keyframes"><strong>可选片段</strong>{focused.videoSegments.map((segment, index) => <button key={segment.id} className={segment.state === 'kept' ? 'selected' : ''} onClick={() => void controls.apply({ type: 'set-video-segment-state', itemId: focused.id, segmentId: segment.id, state: segment.state === 'kept' ? 'rejected' : 'kept' })}><img src={focused.videoKeyframes[index]?.thumbnailUrl} alt="" /><span>{formatTime(segment.startTime)} - {formatTime(segment.endTime)}</span>{segment.state === 'kept' && <Check size={13} />}</button>)}</div>}
        </section>}
      </div>
      <div className="ai-selection-sidebar-footer">
        {stage === 'scenes' && activeScene && <Button variant="primary" icon={<Check size={14} />} onClick={confirmCurrentScene}>{activeScene.confirmation === 'confirmed' ? '已确认时段' : '接受当前建议'}</Button>}
        {stage === 'compare' && activeGroup && <Button variant="primary" icon={<Check size={14} />} onClick={confirmCurrentGroup}>接受本组推荐</Button>}
        {(stage === 'overview' || stage === 'review') && <Button variant="primary" icon={<Check size={14} />} disabled={!session.counts.kept || session.workspaceCreation.status === 'creating'} onClick={() => void createProject()}>创建工作台项目 ({session.counts.kept})</Button>}
      </div>
    </aside>

    <main className="ai-selection-results">
      {stage === 'overview' && <div className="ai-selection-summary"><div><strong>{session.scenes.length}</strong><span>拍摄时段</span></div><div><strong>{session.groups.length}</strong><span>相似组</span></div><div><strong>{session.counts.recommended}</strong><span>推荐</span></div><div><strong>{session.counts.attention}</strong><span>需确认</span></div><div className="primary"><strong>{session.counts.kept}</strong><span>已保留</span></div></div>}
      {stage === 'scenes' && activeScene && <header className="ai-selection-view-heading"><div><h2>{formatShootingPeriod(activeScene.startAt, activeScene.endAt)}</h2><span>{visibleItems.length} 组素材</span></div>{activeScene.confirmation === 'confirmed' && <Button variant="ghost" size="compact" onClick={() => void controls.apply({ type: 'reopen-scene', sceneId: activeScene.id })}>重新检查</Button>}</header>}
      {stage === 'compare' && activeGroup && <header className="ai-selection-view-heading"><div><h2>相似素材比较</h2><span>{activeGroup.itemIds.length} 项</span></div></header>}
      {stage === 'review' && <header className="ai-selection-view-heading"><div><h2>{filters.find((entry) => entry.id === filter)?.label}</h2><span>{visibleItems.length} 项</span></div></header>}
      {visibleItems.length === 0 ? <div className="ai-selection-no-result">{running ? '正在生成结果…' : stage === 'compare' ? '没有需要比较的相似组' : '没有素材'}</div> : <div className={`ai-selection-grid${stage === 'compare' ? ' compare' : ''}`}>{visibleItems.map((item) => <article key={item.id} className={`ai-selection-card state-${item.state}${focused?.id === item.id ? ' active' : ''}${item.analysisState === 'pending' ? ' pending' : ''}`} onClick={() => setFocusedId(item.id)} onDoubleClick={() => openPreview(item)} title={`${item.name} · ${stateLabel(item.state)}`}>
        <div className="ai-selection-thumb"><AiMediaThumb item={item} /><IconButton variant="outline" size="mini" className={`ai-selection-check${item.state === 'kept' ? ' selected' : ''}`} icon={item.state === 'kept' ? <Check size={13} /> : null} onClick={(event) => { event.stopPropagation(); setItemState(item, item.state === 'kept' ? 'undecided' : 'kept') }} aria-label={item.state === 'kept' ? '取消保留' : '保留素材'} />
          {stage === 'scenes' && (groupsByItem.get(item.id)?.itemIds.length ?? 0) > 1 && <span className="ai-selection-group-badge"><Layers3 size={11} />{groupsByItem.get(item.id)?.itemIds.length}</span>}{item.kind === 'video' && <span className="ai-selection-video-badge"><Film size={12} />视频</span>}{item.state === 'recommended' && <span className="ai-selection-recommendation-badge" aria-label="AI 推荐"><Sparkles size={13} /></span>}{isReviewItem(item) && <span className="ai-selection-attention-badge"><CircleAlert size={13} /></span>}
        </div>
      </article>)}</div>}
    </main>
  </div>
  <SelectionSettings open={settingsOpen} onOpenChange={setSettingsOpen} selection={selection} />
  </section>
}

function SelectionSettings({ open, onOpenChange, selection }: { open: boolean; onOpenChange: (open: boolean) => void; selection: ReturnType<typeof useAiSelection> }) {
  const { session, preset, setPreset, purpose, setPurpose, target, setTarget, controls } = selection
  const [targetValue, setTargetValue] = useState(String(target.value ? target.mode === 'ratio' ? target.value * 100 : target.value : ''))
  if (!session) return null
  function updateTarget(mode: AiSelectionTarget['mode'], raw = targetValue): void {
    const value = mode === 'preset' ? null : mode === 'ratio' ? Number(raw || 0) / 100 : Number(raw || 0)
    const next = { mode, value } as AiSelectionTarget
    setTarget(next); void controls.apply({ type: 'set-target', target: next })
  }
  return <Dialog open={open} onOpenChange={onOpenChange} title="选片设置" className="ai-selection-settings-dialog" footer={<Button variant="primary" onClick={() => onOpenChange(false)}>完成</Button>}><div className="ai-selection-settings-body">
    <label><span>选片重点</span><Select variant="compact" fullWidth value={session.purpose ?? purpose} options={[{ value: 'general', label: '快速精选' }, { value: 'people', label: '人物照片' }, { value: 'travel', label: '旅行记录' }, { value: 'editing', label: '剪辑素材' }]} onValueChange={(value) => { const next = value as AiSelectionPurpose; setPurpose(next); void controls.apply({ type: 'set-purpose', purpose: next }) }} /></label>
    <label><span>建议数量</span><ButtonGroup options={[{ value: 'quick', label: '少' }, { value: 'balanced', label: '适中' }, { value: 'deep', label: '多' }]} value={session.preset ?? preset} onChange={(value) => { const next = value as typeof preset; setPreset(next); void controls.apply({ type: 'set-preset', preset: next }) }} /></label>
    <label><span>选片目标</span><ButtonGroup options={[{ value: 'preset', label: '自动' }, { value: 'count', label: '数量' }, { value: 'ratio', label: '比例' }]} value={session.target.mode} onChange={(value) => updateTarget(value as AiSelectionTarget['mode'])} /></label>
    {session.target.mode !== 'preset' && <label><span>{session.target.mode === 'count' ? '目标数量' : '目标比例'}</span><Input variant="compact" value={targetValue} onChange={(event) => setTargetValue(event.target.value.replace(/\D/g, ''))} onBlur={() => updateTarget(session.target.mode)} placeholder={session.target.mode === 'count' ? '张/段' : '%'} /></label>}
  </div></Dialog>
}

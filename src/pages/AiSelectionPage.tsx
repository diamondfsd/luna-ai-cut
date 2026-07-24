import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, CircleAlert, GitMerge, Grid2X2, Images, Layers3, ListChecks, Pause, Pencil, Play, RefreshCw, Settings2, Sparkles, Square, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AiSelectionTaskPicker } from '../ai-selection/AiSelectionTaskPicker'
import { isAiRecommended, isReviewItem, matchesResultFilter, type AiSelectionResultFilter } from '../ai-selection/aiSelectionView'
import { useAiSelection } from '../ai-selection/useAiSelection'
import { MediaCard } from '../components/MediaCard'
import { ThumbImage } from '../components/ThumbImage'
import { showPreviewModal } from '../components/previewModalService'
import type { AiFaceGroup, AiSelectionItem, AiSelectionPurpose, AiSelectionState, AiSelectionTarget, LunaFile } from '../shared/types'
import { Button, ButtonGroup, Dialog, Input, LoadingIndicator, Select, toast } from '../ui'
import '../styles/ai-selection.css'

type SelectionStage = 'overview' | 'recommended' | 'scenes' | 'compare' | 'people' | 'review'

function statusLabel(status: string, phase?: string): string {
  if (status === 'analyzing' && phase === 'photos') return '正在整理照片'
  if (status === 'analyzing' && phase === 'content') return '正在理解画面内容'
  if (status === 'analyzing' && phase === 'people') return '正在检查人物与闭眼'
  if (status === 'analyzing' && phase === 'videos') return '视频整理中'
  return ({ queued: '等待整理', indexing: '正在添加素材', analyzing: '正在整理素材', paused: '已暂停', interrupted: '可以继续', ready: '可以开始选片', completed: '已创建项目', failed: '整理失败', canceled: '已取消' } as Record<string, string>)[status] ?? status
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function shootingPeriodParts(startAt: string, endAt: string): { date: string; time: string; label: string } {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const dateKey = (value: Date): string => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const dateLabel = (value: Date): string => `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`
  const clock = (value: Date): string => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  const sameDate = dateKey(start) === dateKey(end)
  const date = dateLabel(start)
  const time = clock(start) === clock(end) && sameDate
    ? clock(start)
    : `${clock(start)} - ${sameDate ? '' : `${dateLabel(end)} `}${clock(end)}`
  return { date, time, label: `${date} ${time}` }
}

function shootingDateKey(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mediaFileForSelection(item: AiSelectionItem): LunaFile {
  const capturedAt = new Date(item.capturedAt)
  const extension = item.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
  return {
    id: item.id,
    name: item.name,
    href: item.path,
    sourceUrl: item.path,
    url: item.path,
    dateText: capturedAt.toLocaleDateString('zh-CN'),
    timeText: capturedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    sizeText: '',
    bytes: item.bytes,
    kind: item.kind,
    extension,
    capturedAt: item.capturedAt,
    groupDay: item.capturedAt.slice(0, 10),
    groupHour: item.capturedAt.slice(0, 13),
    videoKey: null,
    previewName: null,
    previewUrl: item.thumbnailUrl ?? item.videoKeyframes[0]?.thumbnailUrl ?? null,
    cacheFilePath: item.path,
    downloadFilePath: null,
    thumbnailUrl: item.thumbnailUrl,
    isLivePhoto: false,
    livePhotoVideoName: null,
    livePhotoVideoUrl: null,
    livePhotoCacheFilePath: null,
    downloadName: item.name,
    canPreview: true,
    localPath: item.path,
    duration: item.duration ?? undefined,
  }
}

function FaceGroupCover({ group, item }: { group: AiFaceGroup; item: AiSelectionItem | undefined }) {
  if (!item) return <span className="ai-selection-face-group-cover" />
  const bounds = group.coverBounds
  return <span className="ai-selection-face-group-cover"><ThumbImage
    src={item.thumbnailUrl ?? item.path}
    alt=""
    style={{
      width: `${100 / bounds.width}%`,
      height: `${100 / bounds.height}%`,
      left: `${-bounds.x / bounds.width * 100}%`,
      top: `${-bounds.y / bounds.height * 100}%`,
    }}
  /></span>
}

export function AiSelectionPage() {
  const selection = useAiSelection()
  const { sessions, session, busy, peopleAnalysis, loadingSessions, selectSession, closeSession, startTask, removeSession, controls } = selection
  const [stage, setStage] = useState<SelectionStage>('overview')
  const [focusedId, setFocusedId] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [faceGroupId, setFaceGroupId] = useState('')
  const [filter, setFilter] = useState<AiSelectionResultFilter>('attention')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState('')
  const navigate = useNavigate()

  const items = useMemo(() => session?.items ?? [], [session?.items])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const faceCandidateIds = useMemo(() => items.filter((item) => item.kind === 'image' && item.analysisState === 'ready').map((item) => item.id), [items])
  const groupsByItem = useMemo(() => new Map(session?.groups.flatMap((group) => group.itemIds.map((id) => [id, group] as const)) ?? []), [session?.groups])
  const sortedScenes = useMemo(() => [...(session?.scenes ?? [])].sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)), [session?.scenes])
  const sceneDateGroups = useMemo(() => {
    const groups = new Map<string, { date: string; scenes: typeof sortedScenes }>()
    for (const scene of sortedScenes) {
      const key = shootingDateKey(scene.startAt)
      const existing = groups.get(key)
      if (existing) existing.scenes.push(scene)
      else groups.set(key, { date: shootingPeriodParts(scene.startAt, scene.endAt).date, scenes: [scene] })
    }
    return [...groups.values()]
  }, [sortedScenes])
  const activeScene = sortedScenes.find((scene) => scene.id === sceneId) ?? sortedScenes.find((scene) => scene.confirmation !== 'confirmed') ?? sortedScenes[0] ?? null
  const pendingGroups = useMemo(() => session?.groups.filter((group) => group.confirmation !== 'confirmed' && group.itemIds.length > 1) ?? [], [session?.groups])
  const activeGroup = session?.groups.find((group) => group.id === groupId) ?? pendingGroups[0] ?? null
  const activeFaceGroup = session?.faceGroups.find((group) => group.id === faceGroupId) ?? session?.faceGroups[0] ?? null
  const visibleItems = useMemo(() => {
    if (stage === 'recommended') return items.filter(isAiRecommended)
    if (stage === 'scenes') {
      const sceneItems = items.filter((item) => activeScene?.itemIds.includes(item.id))
      const visibleIds = new Set(sceneItems.map((item) => item.id))
      return sceneItems.filter((item) => {
        const group = groupsByItem.get(item.id)
        if (!group) return true
        return group.itemIds.find((id) => visibleIds.has(id)) === item.id
      })
    }
    if (stage === 'compare') return items.filter((item) => activeGroup?.itemIds.includes(item.id))
    if (stage === 'people') return items.filter((item) => activeFaceGroup?.itemIds.includes(item.id))
    if (stage === 'review') return items.filter((item) => matchesResultFilter(item, filter))
    return items
  }, [activeFaceGroup?.itemIds, activeGroup?.itemIds, activeScene?.itemIds, filter, groupsByItem, items, stage])
  const focused = itemsById.get(focusedId) ?? null
  const running = session?.status === 'indexing' || session?.status === 'analyzing' || session?.status === 'queued'
  const navigationLocked = running || peopleAnalysis.running
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
      isFileSelected: (filePath) => items.find((candidate) => candidate.path === filePath)?.state === 'kept',
      onSetFileSelected: (filePath, selected) => {
        const next = items.find((candidate) => candidate.path === filePath)
        if (next) setItemState(next, selected ? 'kept' : 'undecided')
      },
    })
  }

  function selectStage(next: SelectionStage): void {
    setStage(next)
    setFocusedId('')
    if (next === 'scenes' && activeScene) setSceneId(activeScene.id)
    if (next === 'compare' && activeGroup) setGroupId(activeGroup.id)
    if (next === 'people' && activeFaceGroup) setFaceGroupId(activeFaceGroup.id)
  }

  function confirmCurrentScene(): void {
    if (!session || !activeScene) return
    const index = sortedScenes.findIndex((scene) => scene.id === activeScene.id)
    const next = sortedScenes.slice(index + 1).find((scene) => scene.confirmation !== 'confirmed')
      ?? sortedScenes.slice(0, index).find((scene) => scene.confirmation !== 'confirmed')
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

  useEffect(() => {
    setStage('overview'); setFocusedId(''); setSceneId(''); setGroupId(''); setFaceGroupId('')
  }, [session?.id])

  if (!session) return <section className="ai-selection-page"><AiSelectionTaskPicker sessions={sessions} loading={loadingSessions} busy={busy} onOpenTask={(id) => void selectSession(id)} onCreateTask={startTask} onRemoveTask={removeSession} /></section>

  const stages: Array<{ id: SelectionStage; label: string; icon: typeof Images; count?: number }> = [
    { id: 'overview', label: '分析概览', icon: Grid2X2 },
    { id: 'recommended', label: 'AI 推荐', icon: Sparkles, count: items.filter(isAiRecommended).length },
    { id: 'scenes', label: '拍摄时段', icon: Images, count: session.scenes.filter((scene) => scene.confirmation !== 'confirmed').length },
    { id: 'compare', label: '精准比较', icon: Layers3, count: pendingGroups.length },
    { id: 'people', label: '人物分组', icon: Users, count: session.faceGroups.length },
    { id: 'review', label: '全局复核', icon: CheckCircle2, count: session.counts.attention },
  ]
  const filters: Array<{ id: AiSelectionResultFilter; label: string; count: number }> = [
    { id: 'attention', label: '待确认', count: items.filter((item) => matchesResultFilter(item, 'attention')).length },
    { id: 'kept', label: '已保留', count: session.counts.kept },
    { id: 'rejected', label: '已排除', count: session.counts.rejected },
    { id: 'all', label: '全部', count: session.counts.total },
  ]
  const hasFilterRail = stage === 'scenes' || stage === 'compare' || stage === 'people' || stage === 'review'
  const allVisibleKept = visibleItems.length > 0 && visibleItems.every((item) => item.state === 'kept')
  const selectAllAction = visibleItems.length > 0 && <Button variant="secondary" size="compact" icon={<ListChecks size={14} />} disabled={busy} onClick={() => void controls.apply({ type: 'set-items-state', itemIds: visibleItems.map((item) => item.id), state: allVisibleKept ? 'undecided' : 'kept' })}>{allVisibleKept ? '取消全选' : '全选'}</Button>

  return <section className="ai-selection-page"><div className="ai-selection-layout">
    <aside className="ai-selection-sidebar">
      <div className="ai-selection-sidebar-scroll">
        <Button variant="ghost" size="compact" icon={<ArrowLeft size={15} />} disabled={navigationLocked} onClick={closeSession}>任务列表</Button>
        <div className="ai-selection-sidebar-heading"><Sparkles size={18} /><strong>{session.name}</strong></div>
        <div className="ai-selection-sidebar-status">{statusLabel(session.status, session.phase)} · {session.counts.completed}/{session.counts.total || '—'}</div>
        {running && <div className="ai-selection-progress" aria-label={`整理进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
        <nav className="ai-selection-stage-nav" aria-label="选片流程">{stages.map((entry) => {
          const Icon = entry.icon
          return <Button key={entry.id} variant="ghost" size="compact" className={stage === entry.id ? 'active' : ''} icon={<Icon size={15} />} disabled={navigationLocked} onClick={() => selectStage(entry.id)}><span>{entry.label}</span>{entry.count !== undefined && <strong>{entry.count}</strong>}</Button>
        })}</nav>

        <section className="ai-selection-sidebar-section">
          <Button variant="secondary" size="compact" icon={<Settings2 size={14} />} onClick={() => setSettingsOpen(true)}>选片设置</Button>
          <div className="ai-selection-sidebar-controls">
            {running ? <Button variant="secondary" size="compact" icon={<Pause size={14} />} onClick={controls.pause}>暂停</Button> : !['ready', 'completed'].includes(session.status) && <Button variant="secondary" size="compact" icon={<Play size={14} />} onClick={controls.resume}>继续</Button>}
            {!['ready', 'completed'].includes(session.status) && <Button variant="ghost" size="compact" icon={<Square size={12} />} onClick={controls.cancel}>取消</Button>}
          </div>
        </section>

        {focused?.kind === 'video' && focused.videoSegments.length > 0 && <section className="ai-selection-sidebar-section ai-selection-current-item">
          <strong className="ai-selection-current-name" title={focused.name}>{focused.name}</strong>
          {focused.videoSegments.length > 0 && <div className="ai-selection-keyframes"><strong>可选片段</strong>{focused.videoSegments.map((segment, index) => <button key={segment.id} className={segment.state === 'kept' ? 'selected' : ''} onClick={() => void controls.apply({ type: 'set-video-segment-state', itemId: focused.id, segmentId: segment.id, state: segment.state === 'kept' ? 'rejected' : 'kept' })}><img src={focused.videoKeyframes[index]?.thumbnailUrl} alt="" /><span>{formatTime(segment.startTime)} - {formatTime(segment.endTime)}</span>{segment.state === 'kept' && <Check size={13} />}</button>)}</div>}
        </section>}
      </div>
      <div className="ai-selection-sidebar-footer">
        {stage === 'scenes' && activeScene && <Button variant="primary" icon={<Check size={14} />} onClick={confirmCurrentScene}>{activeScene.confirmation === 'confirmed' ? '已确认时段' : '接受当前建议'}</Button>}
        {stage === 'compare' && activeGroup && <Button variant="primary" icon={<Check size={14} />} onClick={confirmCurrentGroup}>接受本组推荐</Button>}
        {(stage === 'overview' || stage === 'recommended' || stage === 'review') && <Button variant="primary" icon={<Check size={14} />} disabled={!session.counts.kept || session.workspaceCreation.status === 'creating'} onClick={() => void createProject()}>创建工作台项目 ({session.counts.kept})</Button>}
      </div>
    </aside>

    <main className={`ai-selection-results${hasFilterRail ? ' filtered' : ''}`}>
      {hasFilterRail && <aside className="ai-selection-filter-rail">
        <strong className="ai-selection-filter-title">{stage === 'scenes' ? '拍摄时段' : stage === 'compare' ? '相似组' : stage === 'people' ? '人物' : '复核范围'}</strong>
        <div className={`ai-selection-filter-list${stage === 'compare' ? ' compare-covers' : ''}`}>
          {stage === 'scenes' && <div className="ai-selection-date-groups">{sceneDateGroups.map((dateGroup) => <section className="ai-selection-date-group" key={dateGroup.date}>
            <strong className="ai-selection-date-heading">{dateGroup.date}</strong>
            <div className="ai-selection-period-list">{dateGroup.scenes.map((scene) => {
              const period = shootingPeriodParts(scene.startAt, scene.endAt)
              return <Button key={scene.id} variant="ghost" size="compact" className={`ai-selection-period-filter${activeScene?.id === scene.id ? ' active' : ''}`} title={period.label} onClick={() => { setSceneId(scene.id); setFocusedId('') }}><span>{period.time}</span><strong>{countSceneStacks(scene.itemIds)}</strong></Button>
            })}</div>
          </section>)}</div>}
          {stage === 'compare' && pendingGroups.map((group, index) => {
            const cover = itemsById.get(group.representativeId) ?? itemsById.get(group.itemIds[0])
            return <button key={group.id} type="button" className={`ai-selection-compare-filter${activeGroup?.id === group.id ? ' active' : ''}`} aria-label={`查看相似组 ${index + 1}，${group.itemIds.length} 项素材`} onClick={() => { setGroupId(group.id); setFocusedId('') }}>
              <span className="ai-selection-compare-cover">{cover && <ThumbImage src={cover.thumbnailUrl ?? cover.path} alt="" />}</span>
              <strong>{group.itemIds.length}</strong>
            </button>
          })}
          {stage === 'people' && session.faceGroups.map((group) => <Button key={group.id} variant="ghost" size="compact" className={activeFaceGroup?.id === group.id ? 'active' : ''} icon={<FaceGroupCover group={group} item={itemsById.get(group.coverItemId)} />} onClick={() => { setFaceGroupId(group.id); setFocusedId('') }}><span>{group.name}</span><strong>{group.itemIds.length}</strong></Button>)}
          {stage === 'review' && filters.map((entry) => <Button key={entry.id} variant="ghost" size="compact" className={filter === entry.id ? 'active' : ''} onClick={() => { setFilter(entry.id); setFocusedId('') }}><span>{entry.label}</span><strong>{entry.count}</strong></Button>)}
          {stage === 'compare' && pendingGroups.length === 0 && <span className="ai-selection-filter-empty">没有待比较的相似组</span>}
          {stage === 'people' && session.faceGroups.length === 0 && <span className="ai-selection-filter-empty">分析后会显示人物分组</span>}
        </div>
      </aside>}
      <div className="ai-selection-results-content">
      {stage === 'overview' && <><header className="ai-selection-view-heading"><div><h2>全部素材</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header><div className="ai-selection-summary"><div><strong>{session.scenes.length}</strong><span>拍摄时段</span></div><div><strong>{session.groups.length}</strong><span>相似组</span></div><div><strong>{session.counts.recommended}</strong><span>推荐</span></div><div><strong>{session.counts.attention}</strong><span>需确认</span></div><div className="primary"><strong>{session.counts.kept}</strong><span>已保留</span></div></div></>}
      {stage === 'recommended' && <header className="ai-selection-view-heading"><div><h2>AI 推荐</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'scenes' && activeScene && <header className="ai-selection-view-heading"><div><h2>{shootingPeriodParts(activeScene.startAt, activeScene.endAt).label}</h2><span>{visibleItems.length} 组素材</span></div><div className="ai-selection-view-actions">{activeScene.confirmation === 'confirmed' && <Button variant="ghost" size="compact" onClick={() => void controls.apply({ type: 'reopen-scene', sceneId: activeScene.id })}>重新检查</Button>}{selectAllAction}</div></header>}
      {stage === 'compare' && activeGroup && <header className="ai-selection-view-heading"><div><h2>相似素材比较</h2><span>{activeGroup.itemIds.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'people' && <header className="ai-selection-view-heading"><div><h2>{activeFaceGroup?.name ?? '人物分组'}</h2><span>{activeFaceGroup ? `${visibleItems.length} 项` : '尚未分析'}</span></div><div className="ai-selection-view-actions">
        {activeFaceGroup && <Button variant="secondary" size="compact" icon={<Pencil size={14} />} disabled={busy} onClick={() => { setRenameValue(activeFaceGroup.name); setRenameOpen(true) }}>改名</Button>}
        {activeFaceGroup && <Button variant="secondary" size="compact" icon={<GitMerge size={14} />} disabled={busy || session.faceGroups.length < 2} onClick={() => { setMergeSourceId(''); setMergeOpen(true) }}>合并</Button>}
        <Button variant="secondary" size="compact" icon={<RefreshCw size={14} />} disabled={busy || faceCandidateIds.length === 0} onClick={() => void controls.analyzePeople(faceCandidateIds)}>{session.faceGroups.length ? '重新分组' : '开始分析'}</Button>
      </div></header>}
      {stage === 'review' && <header className="ai-selection-view-heading"><div><h2>{filters.find((entry) => entry.id === filter)?.label}</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'people' && peopleAnalysis.running && <section className="ai-selection-people-progress">
        <LoadingIndicator label="正在分析人物" />
        <div><span>{peopleAnalysis.currentLabel ?? '正在准备分析'}</span><strong>{peopleAnalysis.completed}/{peopleAnalysis.total}</strong></div>
        <div className="ai-selection-people-progress-track" aria-label={`人物分析进度 ${peopleAnalysis.completed}/${peopleAnalysis.total}`}><span style={{ width: `${peopleAnalysis.total ? peopleAnalysis.completed / peopleAnalysis.total * 100 : 0}%` }} /></div>
      </section>}
      {visibleItems.length === 0 ? <div className="ai-selection-no-result">{running ? '正在生成结果…' : stage === 'compare' ? '没有需要比较的相似组' : stage === 'people' ? '分析后会按人物整理照片' : '没有素材'}</div> : <div className={`ai-selection-grid${stage === 'compare' ? ' compare' : ''}`}>{visibleItems.map((item) => <MediaCard
          key={item.id}
          file={mediaFileForSelection(item)}
          isDownloadsPage={false}
          selected={item.state === 'kept'}
          progress={undefined}
          selectVisible
          selectionOnly
          className={`ai-selection-media-card${item.state === 'rejected' ? ' rejected' : ''}${item.analysisState === 'pending' ? ' pending' : ''}${focusedId === item.id ? ' focused' : ''}`}
          onToggle={() => setItemState(item, item.state === 'kept' ? 'undecided' : 'kept')}
          onPreview={() => {
            setFocusedId(item.id)
            openPreview(item)
          }}
          onRevealPath={() => undefined}
          onRevealProgress={() => undefined}
          overlay={<div className="ai-selection-card-badges">
            {isAiRecommended(item) && <span className="ai-selection-recommendation-badge"><Sparkles size={12} />AI 推荐</span>}
            {stage === 'scenes' && (groupsByItem.get(item.id)?.itemIds.length ?? 0) > 1 && <span className="ai-selection-group-badge"><Layers3 size={11} />{groupsByItem.get(item.id)?.itemIds.length}</span>}
            {isReviewItem(item) && <span className="ai-selection-attention-badge" aria-label="需要复核"><CircleAlert size={13} /></span>}
          </div>}
        />)}</div>}
      </div>
    </main>
  </div>
  <SelectionSettings open={settingsOpen} onOpenChange={setSettingsOpen} selection={selection} />
  <Dialog open={renameOpen} onOpenChange={setRenameOpen} title="人物名称" footer={<><Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !renameValue.trim()} onClick={async () => { if (!activeFaceGroup) return; if (await controls.renamePerson(activeFaceGroup.id, renameValue)) setRenameOpen(false) }}>保存</Button></>}>
    <div className="ai-selection-person-dialog"><Input variant="compact" fullWidth value={renameValue} maxLength={40} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim() && activeFaceGroup) { void controls.renamePerson(activeFaceGroup.id, renameValue).then((saved) => { if (saved) setRenameOpen(false) }) } }} /></div>
  </Dialog>
  <Dialog open={mergeOpen} onOpenChange={setMergeOpen} title={activeFaceGroup ? `将「${activeFaceGroup.name}」与谁合并？` : '合并人物'} footer={<><Button variant="secondary" onClick={() => setMergeOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !mergeSourceId} onClick={async () => { if (!activeFaceGroup || !mergeSourceId) return; if (await controls.mergePeople(activeFaceGroup.id, mergeSourceId)) setMergeOpen(false) }}>合并</Button></>}>
    <div className="ai-selection-person-merge-list">{session.faceGroups.filter((group) => group.id !== activeFaceGroup?.id).map((group) => <button key={group.id} type="button" className={mergeSourceId === group.id ? 'selected' : ''} onClick={() => setMergeSourceId(group.id)}>
      <FaceGroupCover group={group} item={itemsById.get(group.coverItemId)} /><span>{group.name}</span><strong>{group.itemIds.length}</strong>
    </button>)}</div>
  </Dialog>
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

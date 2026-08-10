import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Grid2X2, Images, Layers3, ListChecks, Pause, Play, Settings2, Sparkles, Square, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AiSelectionTaskPicker } from '../ai-selection/AiSelectionTaskPicker'
import { AiCoPhotoGroupCover } from '../ai-selection/AiPeopleGroupCover'
import { AiSelectionFaceOverlay } from '../ai-selection/AiSelectionFaceOverlay'
import { AiSelectionPeopleActions } from '../ai-selection/AiSelectionPeopleActions'
import { AiSelectionPeopleList } from '../ai-selection/AiSelectionPeopleList'
import { AiSelectionSettingsDialog } from '../ai-selection/AiSelectionSettingsDialog'
import { buildCoPhotoGroups } from '../ai-selection/aiCoPhotoGroups'
import { faceBoxesForGroups } from '../ai-selection/aiFaceOverlayGroups'
import { isAiRecommended, isReviewItem, matchesResultFilter, type AiSelectionResultFilter } from '../ai-selection/aiSelectionView'
import { useAiSelection } from '../ai-selection/useAiSelection'
import { MediaCard } from '../components/MediaCard'
import { ThumbImage } from '../components/ThumbImage'
import { showBatchExportModal, showPreviewModal } from '../components/previewModalService'
import type { AiSelectionItem, AiSelectionState, LunaFile } from '../shared/types'
import { Button, LoadingIndicator, toast } from '../ui'
import '../styles/ai-selection.css'

type SelectionStage = 'overview' | 'recommended' | 'scenes' | 'compare' | 'people' | 'review'

function statusLabel(status: string, phase?: string): string {
  if (status === 'analyzing' && phase === 'photos') return '正在整理照片'
  if (status === 'analyzing' && phase === 'content') return '正在理解画面'
  if (status === 'analyzing' && phase === 'people') return '正在识别人物'
  if (status === 'analyzing' && phase === 'videos') return '正在添加视频'
  return ({ queued: '等待整理', indexing: '正在添加素材', analyzing: '正在整理', paused: '已暂停', interrupted: '整理可继续', ready: '整理完成', completed: '已创建项目', failed: '整理失败', canceled: '已取消' } as Record<string, string>)[status] ?? status
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
    rawCompanion: null,
    canPreview: true,
    localPath: item.path,
    duration: item.duration ?? undefined,
  }
}

export function AiSelectionPage() {
  const selection = useAiSelection()
  const { sessions, session, hiddenPeople, busy, peopleAnalysis, loadingSessions, selectSession, closeSession, startTask, removeSession, controls } = selection
  const [stage, setStage] = useState<SelectionStage>('overview')
  const [focusedId, setFocusedId] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [peopleGroupKey, setPeopleGroupKey] = useState('')
  const [filter, setFilter] = useState<AiSelectionResultFilter>('attention')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showFaceBoxes, setShowFaceBoxes] = useState(false)
  const resultsContentRef = useRef<HTMLDivElement>(null)
  const filterRailRef = useRef<HTMLElement>(null)
  const sceneScrollFrameRef = useRef(0)
  const filterRailScrollFrameRef = useRef(0)
  const sceneNavigationTargetRef = useRef<string | null>(null)
  const navigate = useNavigate()

  const items = useMemo(() => session?.items ?? [], [session?.items])
  const photos = useMemo(() => items.filter((item) => item.kind === 'image'), [items])
  const selectedItems = useMemo(() => items.filter((item) => item.state === 'kept'), [items])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const faceCandidateIds = useMemo(() => items.filter((item) => item.kind === 'image' && item.analysisState === 'ready').map((item) => item.id), [items])
  const groupsByItem = useMemo(() => new Map(session?.groups.flatMap((group) => group.itemIds.map((id) => [id, group] as const)) ?? []), [session?.groups])
  const coPhotoGroups = useMemo(() => buildCoPhotoGroups(session?.faceGroups ?? []), [session?.faceGroups])
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
  const sceneSections = useMemo(() => sortedScenes.map((scene) => ({
    scene,
    items: scene.itemIds.map((id) => itemsById.get(id)).filter((item): item is AiSelectionItem => Boolean(item)),
  })), [itemsById, sortedScenes])
  const activeScene = sortedScenes.find((scene) => scene.id === sceneId) ?? sortedScenes.find((scene) => scene.confirmation !== 'confirmed') ?? sortedScenes[0] ?? null
  const pendingGroups = useMemo(() => session?.groups.filter((group) => group.confirmation !== 'confirmed' && group.itemIds.length > 1) ?? [], [session?.groups])
  const activeGroup = session?.groups.find((group) => group.id === groupId) ?? pendingGroups[0] ?? null
  const activeCoPhotoGroup = peopleGroupKey.startsWith('co-photo:')
    ? coPhotoGroups.find((group) => group.id === peopleGroupKey) ?? null
    : null
  const activeFaceGroup = peopleGroupKey.startsWith('co-photo:')
    ? null
    : session?.faceGroups.find((group) => `person:${group.id}` === peopleGroupKey) ?? session?.faceGroups[0] ?? null
  const activePeopleItemIds = activeCoPhotoGroup?.itemIds ?? activeFaceGroup?.itemIds
  const faceBoxGroupIds = activeCoPhotoGroup?.faceGroupIds ?? (activeFaceGroup ? [activeFaceGroup.id] : [])
  const faceBoxesByItem = showFaceBoxes ? faceBoxesForGroups(session?.faceGroups ?? [], faceBoxGroupIds) : new Map()
  const visibleItems = useMemo(() => {
    if (stage === 'recommended') return items.filter(isAiRecommended)
    if (stage === 'scenes') {
      const seen = new Set<string>()
      return sceneSections.flatMap((section) => section.items).filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
    }
    if (stage === 'compare') return items.filter((item) => activeGroup?.itemIds.includes(item.id))
    if (stage === 'people') return items.filter((item) => activePeopleItemIds?.includes(item.id))
    if (stage === 'review') return photos.filter((item) => matchesResultFilter(item, filter))
    return photos
  }, [activeGroup?.itemIds, activePeopleItemIds, filter, items, photos, sceneSections, stage])
  const focused = itemsById.get(focusedId) ?? null
  const running = session?.status === 'indexing' || session?.status === 'analyzing' || session?.status === 'queued'
  const peopleAnalysisActive = peopleAnalysis.running || (session?.status === 'analyzing' && session.phase === 'people')
  const completedPercent = session?.counts.total ? Math.round(session.counts.completed / session.counts.total * 100) : 0
  const percent = running ? Math.min(96, completedPercent) : completedPercent

  async function createProject(): Promise<void> {
    if (!session) return
    try {
      const project = await window.luna.aiSelection.createWorkspaceProject(session.id, session.name)
      navigate('/workspace', { state: { project, initialIndex: 0 } })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  function exportSelectedItems(): void {
    const paths = selectedItems.map((item) => item.path)
    if (paths.length > 0) showBatchExportModal(paths[0], paths)
  }

  function setItemState(item: AiSelectionItem, state: AiSelectionState): void {
    void controls.apply({ type: 'set-state', itemId: item.id, state })
  }

  function openPreview(item: AiSelectionItem): void {
    const paths = visibleItems.map((candidate) => candidate.path)
    showPreviewModal(item.path, paths.length ? paths : [item.path], false, {
      lightweightPreview: true,
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
    if (next === 'people' && !peopleGroupKey && activeFaceGroup) setPeopleGroupKey(`person:${activeFaceGroup.id}`)
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
    setStage('overview'); setFocusedId(''); setSceneId(''); setGroupId(''); setPeopleGroupKey('')
  }, [session?.id])

  useEffect(() => {
    if (peopleGroupKey.startsWith('co-photo:') && !coPhotoGroups.some((group) => group.id === peopleGroupKey)) setPeopleGroupKey('')
    else if (peopleGroupKey.startsWith('person:') && !session?.faceGroups.some((group) => `person:${group.id}` === peopleGroupKey)) setPeopleGroupKey('')
  }, [coPhotoGroups, peopleGroupKey, session?.faceGroups])

  useEffect(() => {
    const content = resultsContentRef.current
    if (stage !== 'scenes' || !content || sceneSections.length === 0) return
    const sections = [...content.querySelectorAll<HTMLElement>('[data-scene-id]')]
    let frame = 0
    const updateActiveScene = () => {
      if (sceneNavigationTargetRef.current) return
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (sceneNavigationTargetRef.current) return
        const anchor = content.getBoundingClientRect().top + 72
        let activeId = sections[0]?.dataset.sceneId ?? ''
        for (const section of sections) {
          if (section.getBoundingClientRect().top > anchor) break
          activeId = section.dataset.sceneId ?? activeId
        }
        if (activeId) setSceneId(activeId)
      })
    }
    updateActiveScene()
    content.addEventListener('scroll', updateActiveScene, { passive: true })
    window.addEventListener('resize', updateActiveScene)
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(sceneScrollFrameRef.current)
      sceneNavigationTargetRef.current = null
      content.removeEventListener('scroll', updateActiveScene)
      window.removeEventListener('resize', updateActiveScene)
    }
  }, [sceneSections, stage])

  useEffect(() => {
    if (stage !== 'scenes' || !activeScene) return
    if (sceneNavigationTargetRef.current) return
    const rail = filterRailRef.current
    const activeItem = [...(rail?.querySelectorAll<HTMLElement>('[data-scene-nav-id]') ?? [])]
      .find((candidate) => candidate.dataset.sceneNavId === activeScene.id)
    if (!rail || !activeItem) return

    window.cancelAnimationFrame(filterRailScrollFrameRef.current)
    const startTop = rail.scrollTop
    const railRect = rail.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const centeredTop = startTop + itemRect.top - railRect.top - (rail.clientHeight - itemRect.height) / 2
    const maxScrollTop = Math.max(0, rail.scrollHeight - rail.clientHeight)
    const targetTop = Math.min(maxScrollTop, Math.max(0, centeredTop))
    const distance = targetTop - startTop
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 80
    const startTime = performance.now()
    const animate = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration)
      const eased = 1 - (1 - progress) ** 3
      rail.scrollTop = startTop + distance * eased
      if (progress < 1) filterRailScrollFrameRef.current = window.requestAnimationFrame(animate)
    }
    filterRailScrollFrameRef.current = window.requestAnimationFrame(animate)
    return () => {
      window.cancelAnimationFrame(filterRailScrollFrameRef.current)
    }
  }, [activeScene, stage])

  if (!session) return <section className="ai-selection-page"><AiSelectionTaskPicker sessions={sessions} loading={loadingSessions} busy={busy} onOpenTask={(id) => void selectSession(id)} onCreateTask={startTask} onRemoveTask={removeSession} /></section>

  const stages: Array<{ id: SelectionStage; label: string; icon: typeof Images; count?: number }> = [
    { id: 'overview', label: '分析概览', icon: Grid2X2 },
    { id: 'recommended', label: 'AI 推荐', icon: Sparkles, count: items.filter(isAiRecommended).length },
    { id: 'scenes', label: '拍摄时段', icon: Images, count: session.scenes.filter((scene) => scene.confirmation !== 'confirmed').length },
    { id: 'compare', label: '精准比较', icon: Layers3, count: pendingGroups.length },
    { id: 'people', label: '人物分组', icon: Users, count: session.faceGroups.length + coPhotoGroups.length },
    { id: 'review', label: '全局复核', icon: CheckCircle2, count: session.counts.attention },
  ]
  const filters: Array<{ id: AiSelectionResultFilter; label: string; count: number }> = [
    { id: 'attention', label: '待确认', count: photos.filter((item) => matchesResultFilter(item, 'attention')).length },
    { id: 'kept', label: '已保留', count: photos.filter((item) => matchesResultFilter(item, 'kept')).length },
    { id: 'all', label: '全部', count: photos.length },
  ]
  const hasFilterRail = stage === 'scenes' || stage === 'compare' || stage === 'people' || stage === 'review'
  const allVisibleKept = visibleItems.length > 0 && visibleItems.every((item) => item.state === 'kept')
  const selectAllAction = visibleItems.length > 0 && <Button variant="secondary" size="compact" icon={<ListChecks size={14} />} disabled={busy} onClick={() => void controls.apply({ type: 'set-items-state', itemIds: visibleItems.map((item) => item.id), state: allVisibleKept ? 'undecided' : 'kept' })}>{allVisibleKept ? '取消全选' : '全选'}</Button>

  function scrollToScene(nextSceneId: string): void {
    const content = resultsContentRef.current
    const section = [...(content?.querySelectorAll<HTMLElement>('[data-scene-id]') ?? [])]
      .find((candidate) => candidate.dataset.sceneId === nextSceneId)
    setSceneId(nextSceneId)
    setFocusedId('')
    if (!content || !section) return
    const startTop = content.scrollTop
    const resolveTargetTop = () => {
      const contentRect = content.getBoundingClientRect()
      const sectionRect = section.getBoundingClientRect()
      const targetTop = content.scrollTop + sectionRect.top - contentRect.top - 14
      return Math.min(content.scrollHeight - content.clientHeight, Math.max(0, targetTop))
    }
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const startTime = performance.now()

    window.cancelAnimationFrame(sceneScrollFrameRef.current)
    sceneNavigationTargetRef.current = nextSceneId
    const settleAtLatestPosition = (framesRemaining: number) => {
      content.scrollTop = resolveTargetTop()
      if (framesRemaining > 0) {
        sceneScrollFrameRef.current = window.requestAnimationFrame(() => settleAtLatestPosition(framesRemaining - 1))
      } else {
        sceneNavigationTargetRef.current = null
      }
    }
    const animate = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration)
      const eased = 1 - (1 - progress) ** 3
      content.scrollTop = startTop + (resolveTargetTop() - startTop) * eased
      if (progress < 1) {
        sceneScrollFrameRef.current = window.requestAnimationFrame(animate)
      } else {
        settleAtLatestPosition(2)
      }
    }
    sceneScrollFrameRef.current = window.requestAnimationFrame(animate)
  }

  function sceneSelectAction(sceneItems: AiSelectionItem[]) {
    if (sceneItems.length === 0) return null
    const allKept = sceneItems.every((item) => item.state === 'kept')
    return <Button
      variant="secondary"
      size="compact"
      disabled={busy}
      onClick={() => void controls.apply({
        type: 'set-items-state',
        itemIds: sceneItems.map((item) => item.id),
        state: allKept ? 'undecided' : 'kept',
      })}
    >
      {allKept ? '取消全选' : '全选'}
    </Button>
  }

  function renderMediaCard(item: AiSelectionItem) {
    return <MediaCard
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
      onDragStart={item.state === 'kept' ? () => window.luna.startFileDrag(selectedItems.map((candidate) => candidate.path)) : undefined}
      overlay={<>{showFaceBoxes && <AiSelectionFaceOverlay item={item} faces={faceBoxesByItem.get(item.id) ?? []} />}<div className="ai-selection-card-badges">
        {isAiRecommended(item) && <span className="ai-selection-recommendation-badge"><Sparkles size={12} />AI 推荐</span>}
        {stage === 'scenes' && (groupsByItem.get(item.id)?.itemIds.length ?? 0) > 1 && <span className="ai-selection-group-badge"><Layers3 size={11} />{groupsByItem.get(item.id)?.itemIds.length}</span>}
        {isReviewItem(item) && <span className="ai-selection-attention-badge" aria-label="需要复核"><CircleAlert size={13} /></span>}
      </div></>}
    />
  }

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
        {stage === 'compare' && activeGroup && <section className="ai-selection-sidebar-section"><Button variant="secondary" icon={<Check size={14} />} onClick={confirmCurrentGroup}>接受本组推荐</Button></section>}
      </div>
      <div className="ai-selection-sidebar-footer">
        {selectedItems.length > 0 && <span className="ai-selection-sidebar-footer-title">当前已选中 {selectedItems.length} 个素材</span>}
        <Button variant="secondary" disabled={!selectedItems.length} onClick={exportSelectedItems}>导出</Button>
        <Button variant="primary" disabled={!selectedItems.length || session.workspaceCreation.status === 'creating'} onClick={() => void createProject()}>创建项目</Button>
      </div>
    </aside>

    <main className={`ai-selection-results${hasFilterRail ? ' filtered' : ''}${stage === 'people' ? ' people' : ''}`}>
      {hasFilterRail && <aside ref={filterRailRef} className={`ai-selection-filter-rail${stage === 'people' ? ' ai-selection-people-filter-rail' : ''}`}>
        <strong className="ai-selection-filter-title">{stage === 'scenes' ? '拍摄时段' : stage === 'compare' ? '相似组' : stage === 'people' ? '人物' : '复核范围'}</strong>
        <div className={`ai-selection-filter-list${stage === 'compare' ? ' compare-covers' : ''}${stage === 'people' ? ' people' : ''}`}>
          {stage === 'scenes' && <div className="ai-selection-date-groups">{sceneDateGroups.map((dateGroup) => <section className="ai-selection-date-group" key={dateGroup.date}>
            <strong className="ai-selection-date-heading">{dateGroup.date}</strong>
            <div className="ai-selection-period-list">{dateGroup.scenes.map((scene) => {
              const period = shootingPeriodParts(scene.startAt, scene.endAt)
              return <Button key={scene.id} variant="ghost" size="compact" className={`ai-selection-period-filter${activeScene?.id === scene.id ? ' active' : ''}`} data-scene-nav-id={scene.id} title={period.label} onClick={() => scrollToScene(scene.id)}><span>{period.time}</span><strong>{scene.itemIds.length}</strong></Button>
            })}</div>
          </section>)}</div>}
          {stage === 'compare' && pendingGroups.map((group, index) => {
            const cover = itemsById.get(group.representativeId) ?? itemsById.get(group.itemIds[0])
            return <button key={group.id} type="button" className={`ai-selection-compare-filter${activeGroup?.id === group.id ? ' active' : ''}`} aria-label={`查看相似组 ${index + 1}，${group.itemIds.length} 项素材`} onClick={() => { setGroupId(group.id); setFocusedId('') }}>
              <span className="ai-selection-compare-cover">{cover && <ThumbImage src={cover.thumbnailUrl ?? cover.path} alt="" />}</span>
              <strong>{group.itemIds.length}</strong>
            </button>
          })}
          {stage === 'people' && <>
            <AiSelectionPeopleList
              groups={session.faceGroups} activeGroupId={activeFaceGroup?.id} items={items} busy={busy}
              onSelect={(groupId) => { setPeopleGroupKey(`person:${groupId}`); setFocusedId('') }}
              onRename={controls.renamePerson} onSetAvatar={controls.setPersonAvatar}
              onMerge={controls.mergePeople} onUnmerge={controls.unmergePerson} onHide={controls.hidePerson}
            />
            {coPhotoGroups.length > 0 && <strong className="ai-selection-people-filter-heading co-photos">合照</strong>}
            {coPhotoGroups.map((group) => <Button key={group.id} variant="ghost" size="compact" className={activeCoPhotoGroup?.id === group.id ? 'active' : ''} icon={<AiCoPhotoGroupCover item={itemsById.get(group.coverItemId)} />} onClick={() => { setPeopleGroupKey(group.id); setFocusedId('') }}><span>{group.name}</span><strong>{group.itemIds.length}</strong></Button>)}
          </>}
          {stage === 'review' && filters.map((entry) => <Button key={entry.id} variant="ghost" size="compact" className={filter === entry.id ? 'active' : ''} onClick={() => { setFilter(entry.id); setFocusedId('') }}><span>{entry.label}</span><strong>{entry.count}</strong></Button>)}
          {stage === 'compare' && pendingGroups.length === 0 && <span className="ai-selection-filter-empty">没有待比较的相似组</span>}
          {stage === 'people' && session.faceGroups.length === 0 && <span className="ai-selection-filter-empty">没有识别到可分组的人物</span>}
        </div>
      </aside>}
      <div ref={resultsContentRef} className="ai-selection-results-content">
      {stage === 'overview' && <><header className="ai-selection-view-heading"><div><h2>照片概览</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header><div className="ai-selection-summary"><div><strong>{session.scenes.length}</strong><span>拍摄时段</span></div><div><strong>{session.groups.length}</strong><span>相似组</span></div><div><strong>{session.counts.recommended}</strong><span>推荐</span></div><div><strong>{session.counts.attention}</strong><span>需确认</span></div><div className="primary"><strong>{session.counts.kept}</strong><span>已保留</span></div></div></>}
      {stage === 'recommended' && <header className="ai-selection-view-heading"><div><h2>AI 推荐</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'scenes' && <header className="ai-selection-view-heading"><div><h2>全部素材</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'compare' && activeGroup && <header className="ai-selection-view-heading"><div><h2>相似素材比较</h2><span>{activeGroup.itemIds.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'people' && <AiSelectionPeopleActions
        hiddenPeople={hiddenPeople}
        title={activeCoPhotoGroup?.name ?? activeFaceGroup?.name ?? '人物分组'}
        countLabel={activeCoPhotoGroup || activeFaceGroup ? `${visibleItems.length} 项` : '尚未分析'}
        analysisLabel={peopleAnalysisActive ? (peopleAnalysis.running && peopleAnalysis.total > 0 ? `正在分析人物 ${peopleAnalysis.completed}/${peopleAnalysis.total}` : '正在识别人物') : null}
        selectAllAction={selectAllAction}
        busy={busy}
        canShowFaceBoxes={Boolean(activeFaceGroup || activeCoPhotoGroup)}
        showFaceBoxes={showFaceBoxes}
        canAnalyze={faceCandidateIds.length > 0}
        faceGroupingThreshold={session.faceGroupingThreshold}
        onAnalyze={() => void controls.analyzePeople(faceCandidateIds)}
        onFaceGroupingThresholdChange={controls.setFaceGroupingThreshold}
        onShowFaceBoxesChange={setShowFaceBoxes}
        onRestore={controls.restorePerson}
      />}
      {stage === 'review' && <header className="ai-selection-view-heading"><div><h2>{filters.find((entry) => entry.id === filter)?.label}</h2><span>{visibleItems.length} 项</span></div>{selectAllAction}</header>}
      {stage === 'people' && peopleAnalysis.running && <section className="ai-selection-people-progress">
        <LoadingIndicator label="正在分析人物" />
        <div><span>{peopleAnalysis.currentLabel ?? '正在准备分析'}</span><strong>{peopleAnalysis.completed}/{peopleAnalysis.total}</strong></div>
        <div className="ai-selection-people-progress-track" aria-label={`人物分析进度 ${peopleAnalysis.completed}/${peopleAnalysis.total}`}><span style={{ width: `${peopleAnalysis.total ? peopleAnalysis.completed / peopleAnalysis.total * 100 : 0}%` }} /></div>
      </section>}
      {visibleItems.length === 0
        ? <div className="ai-selection-no-result">{running ? '正在生成结果…' : stage === 'compare' ? '没有需要比较的相似组' : stage === 'people' ? '没有识别到可分组的人物' : '没有素材'}</div>
        : stage === 'scenes'
          ? <div className="ai-selection-scene-sections">{sceneSections.map(({ scene, items: sceneItems }) => {
            const period = shootingPeriodParts(scene.startAt, scene.endAt)
            return <section key={scene.id} className="ai-selection-scene-section" data-scene-id={scene.id}>
              <header className="ai-selection-scene-heading">
                <div><h2>{period.label}</h2><span>{sceneItems.length} 项</span></div>
                {sceneSelectAction(sceneItems)}
              </header>
              <div className="ai-selection-grid">{sceneItems.map(renderMediaCard)}</div>
            </section>
          })}</div>
          : <div className={`ai-selection-grid${stage === 'compare' ? ' compare' : ''}`}>{visibleItems.map(renderMediaCard)}</div>}
      </div>
    </main>
  </div>
  <AiSelectionSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} selection={selection} />
  </section>
}

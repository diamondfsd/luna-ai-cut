import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, CircleAlert, Film, FolderOpen, Images, Layers3, Pause, Play, Redo2, ScanSearch, Sparkles, Square, Tag, Undo2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AiMediaThumb } from '../ai-selection/AiMediaThumb'
import { AiComparisonSurvey } from '../ai-selection/AiComparisonSurvey'
import { AiSelectionWelcome } from '../ai-selection/AiSelectionWelcome'
import { AiSelectionWorkflow as AiSelectionWorkflowSteps } from '../ai-selection/AiSelectionWorkflow'
import { useAiSelection } from '../ai-selection/useAiSelection'
import { type AiSelectionItem, type AiSelectionPurpose, type AiSelectionWorkflow } from '../shared/types'
import { AI_SELECTION_CONTENT_TAG_VERSION } from '../shared/types/aiSelection'
import { Button, ButtonGroup, SearchField, Select, toast } from '../ui'
import '../styles/ai-selection.css'

type ResultFilter = 'recommended' | 'compare' | 'review' | 'video' | 'selected' | 'all'

function statusLabel(status: string, phase?: string): string {
  if (status === 'analyzing' && phase === 'photos') return '正在整理照片'
  if (status === 'analyzing' && phase === 'videos') return '照片可以先看，视频还在整理'
  return ({ queued: '即将开始整理', indexing: '正在添加素材', analyzing: '正在整理素材', paused: '已暂停', interrupted: '可以继续整理', completed: '可以开始选片', failed: '整理失败', canceled: '已取消' } as Record<string, string>)[status] ?? status
}

function isReview(item: AiSelectionItem): boolean {
  return Boolean(item.error) || item.quality?.grade === 'review' || item.semanticTags.includes('建议复查')
}

function isRecommended(item: AiSelectionItem): boolean {
  return item.kind === 'image' && !isReview(item) && Boolean(item.recommendationReason) && item.recommendationReason !== '相似组备选'
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function AiSelectionPage() {
  const { sessions, activeId, session, mode, setMode, purpose, setPurpose, workflow, setWorkflow, busy, selectSession, startDirectory, controls } = useAiSelection()
  const [focusedId, setFocusedId] = useState('')
  const [filter, setFilter] = useState<ResultFilter>('recommended')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const items = useMemo(() => session?.items ?? [], [session?.items])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const counts = useMemo(() => ({
    recommended: items.filter(isRecommended).length,
    compare: items.filter((item) => Boolean(item.similarityGroupId)).length,
    review: items.filter(isReview).length,
    video: items.filter((item) => item.kind === 'video').length,
    selected: items.filter((item) => item.selected).length,
    all: items.length,
  }), [items])
  const tagEntries = useMemo(() => {
    const hidden = new Set(['等待分析', '视频故事板', '可用片段'])
    const countsByTag = new Map<string, number>()
    for (const item of items) for (const tag of item.semanticTags) {
      if (!hidden.has(tag)) countsByTag.set(tag, (countsByTag.get(tag) ?? 0) + 1)
    }
    const priority = ['人物', '风景', '城市', '自然风景', '室内', '建筑', '天空', '水面', '美食', '动物', '宠物', '运动', '夜景', '白天', '横屏', '竖屏', '照片', '视频', '短视频', '低光', '模糊', '闭眼', '建议复查']
    return [...countsByTag].sort(([a], [b]) => {
      const ai = priority.indexOf(a); const bi = priority.indexOf(b)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi)
      return a.localeCompare(b, 'zh-CN')
    })
  }, [items])
  const visibleItems = useMemo(() => items.filter((item) => {
    if (filter === 'recommended') return isRecommended(item)
    if (filter === 'compare') return Boolean(item.similarityGroupId)
    if (filter === 'review') return isReview(item)
    if (filter === 'video') return item.kind === 'video'
    if (filter === 'selected') return item.selected
    return true
  }).filter((item) => {
    const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return true
    const haystack = `${item.name} ${item.semanticTags.join(' ')} ${item.recommendationReason ?? ''} ${item.quality?.reasons.join(' ') ?? ''}`.toLocaleLowerCase()
    return terms.every((term) => haystack.includes(term)
      || (['人', '人物', '人像', 'portrait'].some((word) => term.includes(word)) && item.semanticTags.includes('人物'))
      || (['夜', '晚上', '暗光', 'night'].some((word) => term.includes(word)) && item.semanticTags.includes('夜景'))
      || (['闭眼', '眨眼'].some((word) => term.includes(word)) && ['闭眼', '眨眼'].some((tag) => item.semanticTags.includes(tag)))
      || (['切镜', '转场', '变化'].some((word) => term.includes(word)) && item.semanticTags.includes('镜头变化')))
  }), [filter, items, search])
  const focused = itemsById.get(focusedId) ?? visibleItems[0] ?? null
  const focusedGroup = session?.similarityGroups.find((group) => group.id === focused?.similarityGroupId) ?? null
  const groupItems = useMemo(() => focusedGroup?.itemIds.map((id) => itemsById.get(id)).filter((item): item is AiSelectionItem => Boolean(item)) ?? [], [focusedGroup, itemsById])
  const running = session?.status === 'indexing' || session?.status === 'analyzing' || session?.status === 'queued'
  const percent = session?.counts.total ? Math.round(session.counts.completed / session.counts.total * 100) : 0
  const focusCount = new Set(items.filter((item) => isRecommended(item) || isReview(item)).map((item) => item.id)).size
  const compareGroups = session?.similarityGroups.length ?? 0
  const contentTagCounts = useMemo(() => ({
    total: items.filter((item) => item.kind === 'image' && item.analysisState === 'ready').length,
    completed: items.filter((item) => item.kind === 'image' && item.contentTagVersion === AI_SELECTION_CONTENT_TAG_VERSION).length,
    failed: items.filter((item) => item.kind === 'image' && Boolean(item.contentTagError)).length,
  }), [items])

  async function createProject(): Promise<void> {
    if (!session) return
    try {
      const project = await window.luna.aiSelection.createWorkspaceProject(session.id, session.name)
      navigate('/workspace', { state: { project, initialIndex: 0 } })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  function changeDensity(value: string): void {
    const next = value as typeof mode
    setMode(next)
    if (session) void controls.apply({ type: 'set-density', mode: next })
  }

  function changePurpose(value: string): void {
    const next = value as AiSelectionPurpose
    setPurpose(next)
    if (session) void controls.apply({ type: 'set-purpose', purpose: next })
  }

  function changeWorkflow(value: string): void {
    const next = value as AiSelectionWorkflow
    setWorkflow(next)
    if (session) void controls.apply({ type: 'set-workflow', workflow: next })
  }

  const navigation: Array<{ value: ResultFilter; label: string; icon: typeof Sparkles; helper: string }> = [
    { value: 'recommended', label: 'AI 推荐', icon: Sparkles, helper: '从这里开始浏览，满意的素材直接勾选' },
    { value: 'compare', label: '比较相似照片', icon: Layers3, helper: '同一组只需选出最满意的一张' },
    { value: 'review', label: '查看需留意内容', icon: CircleAlert, helper: '确认这些素材是否仍值得保留' },
    { value: 'video', label: '挑选视频片段', icon: Film, helper: '打开一条视频，挑选想保留的部分' },
    { value: 'selected', label: '已选素材', icon: CheckCircle2, helper: '确认无误后完成选片' },
    { value: 'all', label: '全部素材', icon: Images, helper: '这里保留完整素材，不会遗漏' },
  ]
  const activeNavigation = navigation.find((entry) => entry.value === filter) ?? navigation[0]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      const candidates = event.key === ',' || event.key === '.' ? groupItems : visibleItems
      if (candidates.length === 0) return
      const current = Math.max(0, candidates.findIndex((item) => item.id === focused?.id))
      if (event.key === 'ArrowLeft' || event.key === ',') {
        event.preventDefault(); setFocusedId(candidates[(current - 1 + candidates.length) % candidates.length].id)
      } else if (event.key === 'ArrowRight' || event.key === '.') {
        event.preventDefault(); setFocusedId(candidates[(current + 1) % candidates.length].id)
      } else if (event.key.toLowerCase() === 'p' && focused) {
        event.preventDefault(); void controls.apply({ type: 'set-selected', itemId: focused.id, selected: !focused.selected })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controls, focused, groupItems, visibleItems])

  return (
    <section className="ai-selection-page">
      <header className="ai-selection-toolbar">
        <div className="ai-selection-title"><Sparkles size={18} /><span>AI 选片</span></div>
        <AiSelectionWorkflowSteps status={session?.status} selectedCount={counts.selected} />
        {session && <span className="ai-selection-status">{statusLabel(session.status, session.phase)} · {session.counts.completed}/{session.counts.total || '—'}</span>}
        {running && <div className="ai-selection-progress" aria-label={`整理进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
        <div className="ai-selection-actions">
          {running ? <Button variant="secondary" size="compact" icon={<Pause size={14} />} onClick={controls.pause}>暂停</Button> : session && session.status !== 'completed' && <Button variant="secondary" size="compact" icon={<Play size={14} />} onClick={controls.resume}>继续</Button>}
          {session && session.status !== 'completed' && <Button variant="ghost" size="compact" icon={<Square size={12} />} onClick={controls.cancel}>取消</Button>}
          <Button variant="ghost" size="compact" icon={<Undo2 size={14} />} disabled={!session?.canUndo} onClick={controls.undo}>撤销</Button>
          <Button variant="ghost" size="compact" icon={<Redo2 size={14} />} disabled={!session?.canRedo} onClick={controls.redo}>重做</Button>
          <Button variant="primary" size="compact" icon={<Check size={14} />} disabled={!counts.selected} onClick={() => void createProject()}>完成选片 ({counts.selected})</Button>
        </div>
      </header>

      {!session ? (
        <AiSelectionWelcome busy={busy} onStart={() => void startDirectory()} />
      ) : (
        <div className="ai-selection-layout">
          <aside className="ai-selection-sidebar">
            <div className="ai-selection-pane-title">选片任务</div>
            <Select variant="compact" fullWidth value={activeId} placeholder="选片任务" options={sessions.map((item) => ({ value: item.id, label: item.name }))} onValueChange={(value) => void selectSession(value)} />
            <Button variant="secondary" size="compact" className="ai-selection-new-task" icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void startDirectory()}>添加新任务</Button>
            <div className="ai-selection-pane-title">接下来</div>
            <nav className="ai-selection-result-nav" aria-label="选片结果分类">
              {navigation.filter((entry) => ['compare', 'review', 'video'].includes(entry.value)).map((entry) => {
                const Icon = entry.icon
                const count = entry.value === 'compare' ? compareGroups : counts[entry.value]
                const suffix = entry.value === 'compare' ? '组' : entry.value === 'video' ? '条' : '项'
                return <Button key={entry.value} variant="ghost" size="compact" className={filter === entry.value ? 'active' : ''} icon={<Icon size={15} />} onClick={() => { setFilter(entry.value); setFocusedId('') }}><span>{entry.label}</span><strong>{count}{suffix}</strong></Button>
              })}
            </nav>
            <div className="ai-selection-pane-title ai-selection-browse-title">浏览</div>
            <nav className="ai-selection-result-nav" aria-label="浏览选片结果">
              {navigation.filter((entry) => ['recommended', 'selected', 'all'].includes(entry.value)).map((entry) => {
                const Icon = entry.icon
                return <Button key={entry.value} variant="ghost" size="compact" className={filter === entry.value ? 'active' : ''} icon={<Icon size={15} />} onClick={() => { setFilter(entry.value); setFocusedId('') }}><span>{entry.label}</span><strong>{counts[entry.value]}</strong></Button>
              })}
            </nav>
            {tagEntries.length > 0 && <div className="ai-selection-tags-panel">
              <div className="ai-selection-tags-heading"><div className="ai-selection-pane-title"><Tag size={12} />标签分组</div><Button variant="ghost" size="mini" icon={<ScanSearch size={12} />} disabled={busy || contentTagCounts.completed >= contentTagCounts.total} onClick={() => void controls.analyzeContentTags()}>{contentTagCounts.completed >= contentTagCounts.total ? '内容已识别' : '识别内容'}</Button></div>
              <p className="ai-selection-tags-progress">已识别 {contentTagCounts.completed}/{contentTagCounts.total}{contentTagCounts.failed ? ` · ${contentTagCounts.failed} 项可重试` : ''}</p>
              <div className="ai-selection-tag-list">
                {tagEntries.map(([tag, count]) => <Button key={tag} variant="ghost" size="mini" className={search.trim() === tag ? 'active' : ''} onClick={() => setSearch(search.trim() === tag ? '' : tag)}><span>{tag}</span><strong>{count}</strong></Button>)}
              </div>
            </div>}
            <div className="ai-selection-preferences">
              <div className="ai-selection-pane-title">选片偏好</div>
              <label><span>这次要选什么</span><Select variant="compact" fullWidth value={session.purpose ?? purpose} aria-label="这次要选什么" options={[{ value: 'general', label: '快速精选' }, { value: 'people', label: '人物照片' }, { value: 'travel', label: '旅行记录' }, { value: 'editing', label: '剪辑素材' }]} onValueChange={changePurpose} /></label>
              <label><span>由谁确认</span><ButtonGroup options={[{ value: 'assist', label: '我来确认' }, { value: 'auto', label: '自动选中' }]} value={session.workflow ?? workflow} onChange={changeWorkflow} /></label>
              <label><span>保留多少</span><ButtonGroup options={[{ value: 'quick', label: '精简' }, { value: 'balanced', label: '平衡' }, { value: 'deep', label: '丰富' }]} value={session.mode ?? mode} onChange={changeDensity} /></label>
            </div>
          </aside>

          <main className="ai-selection-results">
            <div className="ai-selection-summary">
              <div><strong>{counts.all}</strong><span>原始素材</span></div>
              <div><strong>{focusCount}</strong><span>重点查看</span></div>
              <div><strong>{session.similarityGroups.length}</strong><span>相似组</span></div>
              <div><strong>{counts.review}</strong><span>建议复查</span></div>
              <div className="primary"><strong>{counts.selected}</strong><span>已选择</span></div>
            </div>
            <div className="ai-selection-results-header">
              <div><strong>{activeNavigation.label}</strong><span>{visibleItems.length} 个素材 · {activeNavigation.helper}</span></div>
              <SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索人物、夜景、建筑、动物或文件名" />
            </div>
            {filter === 'compare' && focusedGroup && <AiComparisonSurvey items={groupItems} representativeId={focusedGroup.representativeId} focusedId={focused?.id ?? null} onFocus={setFocusedId} onToggle={(item) => void controls.apply({ type: 'set-selected', itemId: item.id, selected: !item.selected })} onRepresentative={(itemId) => void controls.apply({ type: 'set-representative', groupId: focusedGroup.id, itemId })} />}
            {visibleItems.length === 0 ? <div className="ai-selection-no-result">{running ? '正在生成这部分结果…' : '当前没有需要处理的素材'}</div> : <div className="ai-selection-grid">
              {visibleItems.map((item) => {
                const group = session.similarityGroups.find((candidate) => candidate.id === item.similarityGroupId)
                const representative = group?.representativeId === item.id
                return (
                  <article key={item.id} className={`ai-selection-card${focused?.id === item.id ? ' active' : ''}${item.analysisState === 'pending' ? ' pending' : ''}`} onClick={() => setFocusedId(item.id)}>
                    <div className="ai-selection-thumb"><AiMediaThumb item={item} />
                      <Button variant={item.selected ? 'primary' : 'secondary'} size="mini" className="ai-selection-check" onClick={(event) => { event.stopPropagation(); void controls.apply({ type: 'set-selected', itemId: item.id, selected: !item.selected }) }} aria-label={item.selected ? '取消选择' : '选择素材'}>{item.selected && <Check size={13} />}</Button>
                      {group && <span className="ai-selection-group-badge">{representative ? '推荐' : '备选'} · {group.itemIds.length}</span>}
                      {item.kind === 'video' && <span className="ai-selection-video-badge"><Film size={12} />视频</span>}
                    </div>
                    <div className="ai-selection-card-meta"><span title={item.name}>{item.name}</span><small>{item.analysisState === 'pending' ? '等待分析' : item.recommendationReason ?? (isReview(item) ? '需要人工确认' : '未发现明显风险')}</small></div>
                  </article>
                )
              })}
            </div>}
          </main>

          <aside className="ai-selection-detail">
            <div className="ai-selection-pane-title">为什么放在这里</div>
            {focused ? <>
              <div className="ai-selection-detail-preview"><AiMediaThumb item={focused} />{focused.personEvidence?.bounds && <span className="ai-selection-person-box" style={{ left: `${focused.personEvidence.bounds.x * 100}%`, top: `${focused.personEvidence.bounds.y * 100}%`, width: `${focused.personEvidence.bounds.width * 100}%`, height: `${focused.personEvidence.bounds.height * 100}%` }} />}{focused.personEvidence?.primaryFaceBounds && <span className="ai-selection-face-box" style={{ left: `${focused.personEvidence.primaryFaceBounds.x * 100}%`, top: `${focused.personEvidence.primaryFaceBounds.y * 100}%`, width: `${focused.personEvidence.primaryFaceBounds.width * 100}%`, height: `${focused.personEvidence.primaryFaceBounds.height * 100}%` }} />}</div>
              <h3>{focused.name}</h3>
              <div className={`ai-selection-decision${isReview(focused) ? ' review' : ''}`}>{focused.recommendationReason ?? (isReview(focused) ? '建议再看一眼' : '没有发现明显问题')}</div>
              {focused.quality?.reasons.length ? <ul>{focused.quality.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="ai-selection-muted">没有发现明显问题，可以按内容和喜好决定是否保留。</p>}
              {focused.semanticTags.length > 0 && <section className="ai-selection-detail-tags"><strong>标签</strong><div>{focused.semanticTags.filter((tag) => !['等待分析', '视频故事板', '可用片段'].includes(tag)).map((tag) => <Button key={tag} variant="ghost" size="mini" onClick={() => setSearch(tag)}>{tag}</Button>)}</div></section>}
              {focused.error && <p className="ai-selection-error">这项素材暂时无法读取，可稍后单独重试。</p>}
              <section className="ai-selection-person-evidence">
                <div><strong>看看人物状态</strong><span>{focused.personEvidence ? focused.personEvidence.reason : '比较人物照片时，可以进一步查看清晰度、睁眼和遮挡情况。'}</span></div>
                {focused.personEvidence?.detected && <p>{focused.personEvidence.faceCount ? `找到 ${focused.personEvidence.faceCount} 张人脸` : '已找到人物'}{focused.personEvidence.eyeState !== 'unknown' ? ` · ${focused.personEvidence.eyeState === 'open' ? '人物睁眼' : focused.personEvidence.eyeState === 'closed' ? '可能闭眼' : '人物状态需确认'}` : ''}</p>}
                <Button variant="secondary" size="compact" disabled={busy || focused.analysisState !== 'ready'} onClick={() => void controls.analyzePeople(focusedGroup ? focusedGroup.itemIds : [focused.id])}>{focusedGroup ? '比较人物状态' : '查看人物状态'}</Button>
              </section>
              {focused.kind === 'video' && focused.videoKeyframes.length === 0 && <section className="ai-selection-video-story"><div><strong>挑选视频片段</strong><span>查看几个代表画面，快速找到想保留的部分。</span></div><Button variant="secondary" size="compact" disabled={busy || focused.analysisState !== 'ready'} onClick={() => void controls.analyzeVideos([focused.id])}>查看视频片段</Button></section>}
              {focused.kind === 'video' && focused.videoKeyframes.length > 0 && <section className="ai-selection-video-story">
                <div><strong>挑选视频片段</strong><span>点击片段即可加入或移出已选内容。</span></div>
                <div className="ai-selection-keyframes">{focused.videoKeyframes.map((frame, index) => {
                  const segment = focused.videoSegments[index]
                  return <button key={frame.id} className={segment?.selected ? 'selected' : ''} title={frame.semanticTags.join(' · ')} onClick={() => segment && void controls.apply({ type: 'set-video-segment', itemId: focused.id, segmentId: segment.id, selected: !segment.selected })} aria-label={`选择 ${formatTime(segment?.startTime ?? frame.time)} 到 ${formatTime(segment?.endTime ?? frame.time)} 的片段`}>
                    <img src={frame.thumbnailUrl} alt="" />
                    <span>{formatTime(segment?.startTime ?? frame.time)}–{formatTime(segment?.endTime ?? frame.time)}</span>
                    {segment?.status === 'review' && <em>复查</em>}
                    {segment?.selected && <Check size={13} />}
                  </button>
                })}</div>
              </section>}
              {focusedGroup && <section className="ai-selection-group-detail">
                <div><strong>这一组的其他照片</strong><span>{focusedGroup.reason}</span></div>
                <div className="ai-selection-group-strip">{groupItems.map((item) => <button key={item.id} className={item.id === focused.id ? 'active' : ''} onClick={() => setFocusedId(item.id)} aria-label={`查看 ${item.name}`}><AiMediaThumb item={item} />{focusedGroup.representativeId === item.id && <Sparkles size={12} />}</button>)}</div>
                {focusedGroup.representativeId !== focused.id && <Button variant="secondary" size="compact" icon={<Sparkles size={14} />} onClick={() => void controls.apply({ type: 'set-representative', groupId: focusedGroup.id, itemId: focused.id })}>改选这一项</Button>}
                <Button variant="ghost" size="compact" onClick={() => void controls.apply({ type: 'remove-from-group', groupId: focusedGroup.id, itemId: focused.id })}>这项不属于本组</Button>
              </section>}
            </> : <p className="ai-selection-muted">选择一项素材，看看推荐理由和相近的其他照片。</p>}
          </aside>
        </div>
      )}
    </section>
  )
}

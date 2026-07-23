import { ArrowUpRight, Brush, Building2, CarFront, Check, Circle, CircleDot, Cloud, Crosshair, Hand, Minus, MoreHorizontal, Mountain, MousePointer2, Plus, ScanSearch, Sprout, Square, TreePine, Waves, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Button, ButtonGroup, Popover, PopoverContent, PopoverTrigger, SearchField, Switch, toast } from '../../ui'
import { AUTOMATIC_SEGMENTATION_TARGETS, isSamSegmentationModel, type AutomaticSegmentationTarget, type AutomaticSegmentationTargetId } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import type { MaskManualTool } from '../context/WorkspaceMaskContextTypes'
import type { MaskSelectionOperation } from './maskSelectionOperations'
import './MaskPanel.css'

const TARGET_ICONS: Record<string, LucideIcon> = {
  sky: Cloud,
  water: Waves,
  subject: ScanSearch,
  tree: TreePine,
  building: Building2,
  vehicle: CarFront,
  mountain: Mountain,
  'ade20k-9': Sprout,
}
const ADJUSTMENT_TOOLS: Array<{ value: MaskManualTool; label: ReactNode }> = [
  { value: 'move', label: <><Hand size={18} />移动</> },
  { value: 'brush', label: <><Brush size={18} />画笔</> },
]
const SHAPE_TOOLS: Array<{ value: MaskManualTool; label: ReactNode }> = [
  { value: 'rectangle', label: <><Square size={18} />矩形</> },
  { value: 'ellipse', label: <><Circle size={18} />椭圆</> },
]
const GRADIENT_TOOLS: Array<{ value: MaskManualTool; label: ReactNode }> = [
  { value: 'linear-gradient', label: <><ArrowUpRight size={18} />线性</> },
  { value: 'radial-gradient', label: <><CircleDot size={18} />径向</> },
]
const SELECTION_OPERATIONS: Array<{ value: MaskSelectionOperation; label: ReactNode }> = [
  { value: 'replace', label: <><MousePointer2 size={16} />选择</> },
  { value: 'add', label: <><Plus size={16} />叠加</> },
  { value: 'subtract', label: <><Minus size={16} />减去</> },
]
const ADVANCED_MASK_EDITING_ENABLED = import.meta.env.VITE_ADVANCED_MASK_EDITING !== 'false'
const PRIMARY_TARGET_IDS = ['sky', 'water', 'tree', 'building', 'vehicle', 'mountain', 'ade20k-9'] as const
const CATEGORY_TARGETS = PRIMARY_TARGET_IDS.map((id) => AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === id)!)
const SUBJECT_TARGET = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === 'subject')!
const MORE_TARGETS = AUTOMATIC_SEGMENTATION_TARGETS.filter(
  (target) => target.id !== 'subject' && !PRIMARY_TARGET_IDS.some((id) => id === target.id),
)
export function MaskPanel() {
  const mask = useWorkspaceMask()
  const media = useWorkspaceMedia()
  const isVideo = media.activeMedia?.kind === 'video'
  const settings = mask.activeMask
  const hasVectorComponents = settings?.components?.some((component) => component.type !== 'raster') ?? false
  const initialTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === settings?.targetId || target.classId === settings?.classId)?.id ?? 'sky'
  const [targetId, setTargetId] = useState<AutomaticSegmentationTargetId>(initialTarget)
  const [runningTargetId, setRunningTargetId] = useState<AutomaticSegmentationTargetId | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreSearch, setMoreSearch] = useState('')
  const [automaticMode, setAutomaticMode] = useState<'target' | 'point'>(() => settings?.modelId && isSamSegmentationModel(settings.modelId) ? 'point' : 'target')

  useEffect(() => {
    const activeTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === mask.activeMask?.targetId || target.classId === mask.activeMask?.classId)
    if (activeTarget) {
      setTargetId(activeTarget.id)
      setAutomaticMode('target')
    } else if (mask.activeMask?.modelId && isSamSegmentationModel(mask.activeMask.modelId)) {
      setAutomaticMode('point')
    }
  }, [mask.activeMask?.classId, mask.activeMask?.modelId, mask.activeMask?.targetId])

  const pointSelectionRunning = automaticMode === 'point' && runningTargetId === null && mask.busy && mask.segmentationProgress !== null
  const pointProgress = pointSelectionRunning ? mask.segmentationProgress : null
  const pointProgressIndeterminate = !pointProgress || pointProgress.percent === null
  const normalizedMoreSearch = moreSearch.trim().toLocaleLowerCase('zh-CN')
  const filteredMoreTargets = useMemo(
    () => normalizedMoreSearch
      ? MORE_TARGETS.filter((item) => item.label.toLocaleLowerCase('zh-CN').includes(normalizedMoreSearch))
      : MORE_TARGETS,
    [normalizedMoreSearch],
  )
  const moreSelected = automaticMode === 'target' && MORE_TARGETS.some((item) => item.id === targetId)
  const moreRunning = runningTargetId !== null && MORE_TARGETS.some((item) => item.id === runningTargetId)

  const clearAutomaticSelectionError = (): void => {
    mask.clearSegmentationError()
  }

  const startAutomaticSelection = async (selectedTargetId: AutomaticSegmentationTargetId): Promise<void> => {
    if (isVideo) return
    if (runningTargetId === selectedTargetId && mask.busy) {
      mask.cancelSegmentation()
      return
    }
    if (mask.busy || runningTargetId !== null) return
    clearAutomaticSelectionError()
    mask.setSemanticPicking(false)
    mask.setManualTool('move')
    setAutomaticMode('target')
    setTargetId(selectedTargetId)
    setRunningTargetId(selectedTargetId)
    try {
      const selectedTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((item) => item.id === selectedTargetId)
      if (!selectedTarget) return
      await mask.generateSemanticMask(undefined, selectedTargetId)
    } finally {
      setRunningTargetId(null)
    }
  }

  const togglePointSelection = (): void => {
    if (isVideo) return
    if (pointSelectionRunning) {
      mask.cancelSegmentation()
      mask.setSemanticPicking(false)
      return
    }
    if (mask.busy || runningTargetId !== null) return
    clearAutomaticSelectionError()
    mask.setManualTool('move')
    setAutomaticMode('point')
    mask.setSemanticPicking(!mask.semanticPicking)
  }

  const retryAutomaticSelection = (): void => {
    if (automaticMode === 'point') {
      clearAutomaticSelectionError()
      mask.setSemanticPicking(true)
      return
    }
    void startAutomaticSelection(targetId)
  }

  const selectManualTool = (value: MaskManualTool): void => {
    const isGradient = value === 'linear-gradient' || value === 'radial-gradient'
    const hasSelection = Boolean(mask.activeMask?.path || mask.activeMask?.components?.some((component) => component.type !== 'linear-gradient' && component.type !== 'radial-gradient'))
    if (isGradient && !hasSelection) {
      toast.error('请先创建或选择一个选区')
      return
    }
    mask.setSemanticPicking(false)
    mask.setManualTool(value)
  }

  const automaticSelectionError = mask.segmentationError
  const renderTargetButton = (item: AutomaticSegmentationTarget) => {
    const Icon = TARGET_ICONS[item.id]
    const isRunning = runningTargetId === item.id
    const progress = isRunning ? mask.segmentationProgress : null
    const indeterminate = !progress || progress.percent === null
    return (
      <Button
        key={item.id}
        variant="ghost"
        className={[automaticMode === 'target' && item.id === targetId ? 'is-active' : '', isRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
        disabled={(mask.busy || runningTargetId !== null) && !isRunning}
        aria-label={isRunning ? `取消${item.label}自动选择` : `${item.label}自动选择`}
        onClick={() => void startAutomaticSelection(item.id)}
      >
        <span className="workspace-mask-target-content">
          {isRunning ? <X size={18} /> : <Icon size={20} />}
          <span>{progress?.percent !== null && progress?.percent !== undefined ? `${progress.percent}%` : item.label}</span>
        </span>
        {isRunning && (
          <span className="workspace-mask-target-progress" aria-hidden="true">
            <span className={indeterminate ? 'is-indeterminate' : undefined} style={indeterminate ? undefined : { width: `${progress?.percent ?? 0}%` }} />
          </span>
        )}
      </Button>
    )
  }

  return (
    <div className="workspace-mask-panel">
      {!isVideo && <section className="workspace-mask-auto-section">
        <h3 className="workspace-mask-section-heading">自动选择</h3>
        <div className="workspace-mask-auto-targets" aria-label="自动选择类型">
          {CATEGORY_TARGETS.map(renderTargetButton)}
          <Popover open={moreOpen} onOpenChange={(open) => { setMoreOpen(open); if (!open) setMoreSearch('') }}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className={[moreSelected ? 'is-active' : '', moreRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
                disabled={(mask.busy || runningTargetId !== null) && !moreRunning}
                aria-label="选择更多自动类型"
              >
                <span className="workspace-mask-target-content">
                  <MoreHorizontal size={20} />
                  <span>更多</span>
                </span>
                {moreRunning && (
                  <span className="workspace-mask-target-progress" aria-hidden="true">
                    <span
                      className={!mask.segmentationProgress || mask.segmentationProgress.percent === null ? 'is-indeterminate' : undefined}
                      style={mask.segmentationProgress?.percent === null ? undefined : { width: `${mask.segmentationProgress?.percent ?? 0}%` }}
                    />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="workspace-mask-more-popover" align="end" sideOffset={8}>
              <div className="workspace-mask-more-search" data-popover-header>
                <SearchField
                  fullWidth
                  value={moreSearch}
                  onChange={(event) => setMoreSearch(event.target.value)}
                  placeholder="搜索类型"
                  aria-label="搜索自动选择类型"
                />
              </div>
              <div className="workspace-mask-more-list" role="listbox" aria-label="更多自动选择类型">
                {filteredMoreTargets.map((item) => {
                  const isSelected = automaticMode === 'target' && item.id === targetId
                  const isRunning = runningTargetId === item.id
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      size="mini"
                      role="option"
                      aria-selected={isSelected}
                      className={isSelected ? 'is-active' : undefined}
                      disabled={(mask.busy || runningTargetId !== null) && !isRunning}
                      onClick={() => {
                        void startAutomaticSelection(item.id)
                        if (!isRunning) {
                          setMoreOpen(false)
                          setMoreSearch('')
                        }
                      }}
                    >
                      <span>{item.label}</span>
                      {isRunning ? <X size={15} /> : isSelected ? <Check size={15} /> : null}
                    </Button>
                  )
                })}
                {filteredMoreTargets.length === 0 && <p className="workspace-mask-more-empty">没有匹配的类型</p>}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="workspace-mask-smart-targets" aria-label="主体与点选">
          {renderTargetButton(SUBJECT_TARGET)}
          <Button
            variant="ghost"
            className={[automaticMode === 'point' ? 'is-active' : '', pointSelectionRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
            disabled={(mask.busy || runningTargetId !== null) && !pointSelectionRunning}
            aria-label={pointSelectionRunning ? '取消点选' : mask.semanticPicking ? '退出点选' : '使用点选'}
            onClick={togglePointSelection}
          >
            <span className="workspace-mask-target-content">
              {pointSelectionRunning ? <X size={18} /> : <Crosshair size={20} />}
              <span>{pointProgress?.percent !== null && pointProgress?.percent !== undefined ? `${pointProgress.percent}%` : '点选'}</span>
            </span>
            {pointSelectionRunning && (
              <span className="workspace-mask-target-progress" aria-hidden="true">
                <span
                  className={pointProgressIndeterminate ? 'is-indeterminate' : undefined}
                  style={pointProgressIndeterminate ? undefined : { width: `${pointProgress.percent ?? 0}%` }}
                />
              </span>
            )}
          </Button>
        </div>
        {mask.segmentationProgress && (
          <div className="workspace-mask-auto-progress" role="status">
            <span>{mask.segmentationProgress.label}</span>
            {mask.segmentationProgress.percent !== null && <strong>{mask.segmentationProgress.percent}%</strong>}
          </div>
        )}
        {automaticSelectionError && !mask.segmentationProgress && (
          <div className="workspace-mask-auto-error" role="alert">
            <p>{automaticSelectionError}</p>
            <div>
              <Button size="mini" variant="secondary" onClick={retryAutomaticSelection}>重试</Button>
              <Button size="mini" variant="ghost" onClick={() => { clearAutomaticSelectionError(); mask.setSelectionOperation('add'); mask.setManualTool('brush') }}>使用画笔修补</Button>
            </div>
          </div>
        )}
      </section>}

      <section className="workspace-mask-brush-section">
        <h3 className="workspace-mask-section-heading">选区工具</h3>
        <div className="workspace-mask-editor-section">
          {ADVANCED_MASK_EDITING_ENABLED && (
            <div className="workspace-mask-tool-row">
              <strong>方式</strong>
              <ButtonGroup
                className="workspace-mask-operation-modes"
                options={SELECTION_OPERATIONS}
                value={mask.selectionOperation}
                onChange={mask.setSelectionOperation}
              />
            </div>
          )}
          <div className="workspace-mask-tool-row">
            <strong>调整</strong>
            <ButtonGroup
              className="workspace-mask-tool-modes"
              options={ADJUSTMENT_TOOLS}
              value={mask.manualTool}
              onChange={selectManualTool}
            />
          </div>
          {ADVANCED_MASK_EDITING_ENABLED && (
            <>
              <div className="workspace-mask-tool-row">
                <strong>形状</strong>
                <ButtonGroup
                  className="workspace-mask-tool-modes"
                  options={SHAPE_TOOLS}
                  value={mask.manualTool}
                  onChange={selectManualTool}
                />
              </div>
              <div className="workspace-mask-tool-row is-separated">
                <strong>渐变</strong>
                <ButtonGroup
                  className="workspace-mask-tool-modes"
                  options={GRADIENT_TOOLS}
                  value={mask.manualTool}
                  onChange={selectManualTool}
                />
              </div>
            </>
          )}
          {mask.manualTool === 'brush' && (
            <>
              <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={100} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}`} />
              <ParamSlider label="画笔羽化" value={mask.brushFeather} min={0} max={100} onChange={mask.setBrushFeather} formatValue={(value) => `${Math.round(value)}%`} />
            </>
          )}
          <label className="workspace-mask-setting-row">
            <strong>显示选区</strong>
            <Switch ariaLabel="显示选区" checked={mask.showOverlay} onCheckedChange={mask.setShowOverlay} />
          </label>
        </div>
      </section>

      <section className="workspace-mask-edge-section">
        <h3 className="workspace-mask-section-heading">边缘</h3>
        <div className="workspace-mask-editor-section">
          {!hasVectorComponents && (
            <ParamSlider
              label="羽化"
              value={settings?.feather ?? 0}
              min={0}
              max={100}
              onChange={(feather) => mask.updateGroupedMaskSettings({ feather }, 'feather')}
              onCommit={(feather) => mask.updateGroupedMaskSettings({ feather }, 'feather', true)}
              formatValue={(value) => `${Math.round(value)}`}
            />
          )}
          <ParamSlider
            label="不透明度"
            value={Math.round((settings?.opacity ?? 1) * 100)}
            min={0}
            max={100}
            onChange={(opacity) => mask.updateGroupedMaskSettings({ opacity: opacity / 100 }, 'opacity')}
            onCommit={(opacity) => mask.updateGroupedMaskSettings({ opacity: opacity / 100 }, 'opacity', true)}
            formatValue={(value) => `${Math.round(value)}`}
          />
          <label className="workspace-mask-setting-row">
            <strong>反相蒙版</strong>
            <Switch ariaLabel="反相蒙版" checked={settings?.inverted ?? false} disabled={!settings} onCheckedChange={(inverted) => mask.updateMaskSettings({ inverted })} />
          </label>
        </div>
      </section>
    </div>
  )
}

import { Brush, Building2, CarFront, Cloud, Crosshair, Eraser, Hand, Mountain, ScanSearch, TreePine, UserRound, Waves, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button, ButtonGroup, Select, Switch } from '../../ui'
import { AUTOMATIC_SEGMENTATION_TARGETS, DEFAULT_POINT_SEGMENTATION_MODEL_ID, isSamSegmentationModel, isSubjectSegmentationModel, SAM_MODELS, SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS, type AutomaticSegmentationTargetId, type SubjectSegmentationModelId } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const TARGET_ICONS = {
  sky: Cloud,
  water: Waves,
  person: UserRound,
  subject: ScanSearch,
  tree: TreePine,
  building: Building2,
  vehicle: CarFront,
  mountain: Mountain,
}
const BRUSH_MODES = [
  { value: 'move', label: <><Hand size={18} />移动</> },
  { value: 'paint', label: <><Brush size={18} />添加</> },
  { value: 'erase', label: <><Eraser size={18} />擦除</> },
]
const CATEGORY_TARGETS = AUTOMATIC_SEGMENTATION_TARGETS.filter((target) => target.id !== 'subject')
const SUBJECT_TARGET = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === 'subject')!
const SUBJECT_MODEL_STORAGE_KEY = 'workspace_subject_segmentation_model'
const SUBJECT_MODEL_OPTIONS = [
  { value: 'birefnet-general-lite', label: 'BiRefNet Lite（当前）' },
  { value: 'rmbg-1.4', label: 'RMBG 1.4' },
]
function formatModelSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

export function MaskPanel() {
  const mask = useWorkspaceMask()
  const settings = mask.activeMask
  const initialTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === settings?.targetId || target.classId === settings?.classId)?.id ?? 'sky'
  const [targetId, setTargetId] = useState<AutomaticSegmentationTargetId>(initialTarget)
  const [developerMode, setDeveloperMode] = useState<boolean | null>(null)
  const [runningTargetId, setRunningTargetId] = useState<AutomaticSegmentationTargetId | null>(null)
  const [selectionMode, setSelectionMode] = useState<'target' | 'point'>(() => settings?.modelId && isSamSegmentationModel(settings.modelId) ? 'point' : 'target')
  const [subjectModelId, setSubjectModelId] = useState<SubjectSegmentationModelId>(() => {
    const saved = localStorage.getItem(SUBJECT_MODEL_STORAGE_KEY)
    return saved && isSubjectSegmentationModel(saved) ? saved : 'birefnet-general-lite'
  })

  useEffect(() => {
    const activeTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === mask.activeMask?.targetId || target.classId === mask.activeMask?.classId)
    if (activeTarget) {
      setTargetId(activeTarget.id)
      setSelectionMode('target')
      if (activeTarget.id === 'subject' && mask.activeMask?.modelId && isSubjectSegmentationModel(mask.activeMask.modelId)) {
        setSubjectModelId(mask.activeMask.modelId)
      }
    } else if (mask.activeMask?.modelId && isSamSegmentationModel(mask.activeMask.modelId)) {
      setSelectionMode('point')
    }
  }, [mask.activeMask?.classId, mask.activeMask?.modelId, mask.activeMask?.targetId])

  useEffect(() => {
    localStorage.setItem(SUBJECT_MODEL_STORAGE_KEY, subjectModelId)
  }, [subjectModelId])

  useEffect(() => {
    let active = true
    window.luna.getSettings()
      .then((appSettings) => {
        if (active) setDeveloperMode(Boolean(appSettings.developerMode))
      })
      .catch(() => {
        if (active) setDeveloperMode(false)
      })
    return () => { active = false }
  }, [])

  const target = useMemo(
    () => AUTOMATIC_SEGMENTATION_TARGETS.find((item) => item.id === targetId) ?? AUTOMATIC_SEGMENTATION_TARGETS[0],
    [targetId],
  )
  const automaticSelectionModel = [...SEGMENTATION_MODELS, ...SPECIALIZED_SEGMENTATION_MODELS, ...SAM_MODELS].find(
    (model) => model.id === (selectionMode === 'point'
      ? DEFAULT_POINT_SEGMENTATION_MODEL_ID
      : target.id === 'subject' ? subjectModelId : target.modelId),
  )
  const pointSelectionRunning = selectionMode === 'point' && runningTargetId === null && mask.busy && mask.segmentationProgress !== null
  const pointProgress = pointSelectionRunning ? mask.segmentationProgress : null
  const pointProgressIndeterminate = !pointProgress || pointProgress.percent === null

  const clearAutomaticSelectionError = (): void => {
    mask.clearSegmentationError()
  }

  const startAutomaticSelection = async (selectedTargetId: AutomaticSegmentationTargetId): Promise<void> => {
    if (runningTargetId === selectedTargetId && mask.busy) {
      mask.cancelSegmentation()
      return
    }
    if (mask.busy || runningTargetId !== null) return
    clearAutomaticSelectionError()
    mask.setSemanticPicking(false)
    mask.setBrushActive(false)
    setSelectionMode('target')
    setTargetId(selectedTargetId)
    setRunningTargetId(selectedTargetId)
    try {
      const selectedTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((item) => item.id === selectedTargetId)
      if (!selectedTarget) return
      await mask.generateSemanticMask(undefined, selectedTargetId, selectedTargetId === 'subject' ? subjectModelId : undefined)
    } finally {
      setRunningTargetId(null)
    }
  }

  const togglePointSelection = (): void => {
    if (pointSelectionRunning) {
      mask.cancelSegmentation()
      return
    }
    if (mask.busy || runningTargetId !== null) return
    clearAutomaticSelectionError()
    mask.setBrushActive(false)
    setSelectionMode('point')
    mask.setSemanticPicking(!mask.semanticPicking)
  }

  const retryAutomaticSelection = (): void => {
    if (selectionMode === 'point') {
      clearAutomaticSelectionError()
      mask.setSemanticPicking(true)
      return
    }
    void startAutomaticSelection(targetId)
  }

  const automaticSelectionError = mask.segmentationError
  const renderTargetButton = (item: typeof AUTOMATIC_SEGMENTATION_TARGETS[number]) => {
    const Icon = TARGET_ICONS[item.id]
    const isRunning = runningTargetId === item.id
    const progress = isRunning ? mask.segmentationProgress : null
    const indeterminate = !progress || progress.percent === null
    return (
      <Button
        key={item.id}
        variant="ghost"
        className={[selectionMode === 'target' && item.id === targetId ? 'is-active' : '', isRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
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
      <section className="workspace-mask-auto-section">
        <h3 className="workspace-mask-section-heading">自动选择</h3>
        <div className="workspace-mask-auto-targets" aria-label="自动选择类型">
          {CATEGORY_TARGETS.map(renderTargetButton)}
        </div>
        <div className="workspace-mask-smart-targets" aria-label="主体与点选">
          {renderTargetButton(SUBJECT_TARGET)}
          <Button
            variant="ghost"
            className={[selectionMode === 'point' ? 'is-active' : '', pointSelectionRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
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
        <label className="workspace-mask-subject-model-field">
          <strong>主体模型</strong>
          <Select
            variant="compact"
            fullWidth
            disabled={mask.busy || runningTargetId !== null}
            options={SUBJECT_MODEL_OPTIONS}
            value={subjectModelId}
            onValueChange={(value) => {
              if (isSubjectSegmentationModel(value)) setSubjectModelId(value)
            }}
          />
        </label>
        {mask.segmentationProgress && (
          <div className="workspace-mask-auto-progress" role="status">
            <span>{mask.segmentationProgress.label}</span>
            {mask.segmentationProgress.percent !== null && <strong>{mask.segmentationProgress.percent}%</strong>}
          </div>
        )}
        {developerMode && automaticSelectionModel && (
          <div className="workspace-mask-model-field">
            <strong>模型</strong>
            <span>{automaticSelectionModel.name} · {formatModelSize(automaticSelectionModel.sizeBytes)}</span>
          </div>
        )}
        {automaticSelectionError && !mask.segmentationProgress && (
          <div className="workspace-mask-auto-error" role="alert">
            <p>{automaticSelectionError}</p>
            <div>
              <Button size="mini" variant="secondary" onClick={retryAutomaticSelection}>重试</Button>
              <Button size="mini" variant="ghost" onClick={() => { clearAutomaticSelectionError(); mask.setBrushActive(true) }}>使用画笔修补</Button>
            </div>
          </div>
        )}
      </section>

      <section className="workspace-mask-brush-section">
        <h3 className="workspace-mask-section-heading">画笔修补</h3>
        <div className="workspace-mask-editor-section">
          <div className="workspace-mask-mode-row">
            <strong>工具</strong>
            <ButtonGroup
              className="workspace-mask-brush-modes"
              options={BRUSH_MODES}
              value={mask.brushActive ? mask.brushMode : 'move'}
              onChange={(value) => {
                mask.setSemanticPicking(false)
                if (value === 'move') {
                  mask.setBrushActive(false)
                  return
                }
                mask.setBrushMode(value as 'paint' | 'erase')
                mask.setBrushActive(true)
              }}
            />
          </div>
          <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={100} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}`} />
          <label className="workspace-mask-setting-row">
            <strong>显示选区</strong>
            <Switch ariaLabel="显示选区" checked={mask.showOverlay} onCheckedChange={mask.setShowOverlay} />
          </label>
        </div>
      </section>

      <section className="workspace-mask-edge-section">
        <h3 className="workspace-mask-section-heading">边缘</h3>
        <div className="workspace-mask-editor-section">
          <ParamSlider
            label="羽化"
            value={settings?.feather ?? 2}
            min={0}
            max={40}
            onChange={(feather) => mask.updateGroupedMaskSettings({ feather }, 'feather')}
            onCommit={(feather) => mask.updateGroupedMaskSettings({ feather }, 'feather', true)}
            formatValue={(value) => `${Math.round(value)}`}
          />
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

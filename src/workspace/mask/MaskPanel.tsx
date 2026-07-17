import { Brush, Cloud, Eraser, ScanSearch, TreePine, UserRound, Waves, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Accordion, Button, ButtonGroup, Switch } from '../../ui'
import { AUTOMATIC_SEGMENTATION_TARGETS, SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS, type AutomaticSegmentationTargetId } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const TARGET_ICONS = { sky: Cloud, water: Waves, person: UserRound, subject: ScanSearch, tree: TreePine }
const BRUSH_MODES = [
  { value: 'paint', label: <><Brush size={18} />添加</> },
  { value: 'erase', label: <><Eraser size={18} />擦除</> },
]
const AUTOMATIC_MODEL_IDS = [...new Set(AUTOMATIC_SEGMENTATION_TARGETS.map((target) => target.modelId))]

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

  useEffect(() => {
    const activeTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((target) => target.id === mask.activeMask?.targetId || target.classId === mask.activeMask?.classId)
    if (activeTarget) setTargetId(activeTarget.id)
  }, [mask.activeMask?.classId, mask.activeMask?.targetId])

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
  const automaticSelectionModel = [...SEGMENTATION_MODELS, ...SPECIALIZED_SEGMENTATION_MODELS].find((model) => model.id === target.modelId)

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
    setTargetId(selectedTargetId)
    setRunningTargetId(selectedTargetId)
    try {
      const selectedTarget = AUTOMATIC_SEGMENTATION_TARGETS.find((item) => item.id === selectedTargetId)
      if (!selectedTarget) return
      try {
        const status = await window.luna.workspace.getSegmentationModelStatus(selectedTarget.modelId)
        if (!status.cached) {
          const prioritizedModels = [selectedTarget.modelId, ...AUTOMATIC_MODEL_IDS.filter((modelId) => modelId !== selectedTarget.modelId)]
          void window.luna.workspace.prepareSegmentationModels(prioritizedModels).catch(() => undefined)
        }
      } catch {
        // The selection request below uses the same loader and reports actionable errors.
      }
      await mask.generateSemanticMask(undefined, selectedTargetId)
    } finally {
      setRunningTargetId(null)
    }
  }

  const automaticSelectionError = mask.segmentationError

  return (
    <div className="workspace-mask-panel">
      <section className="workspace-mask-auto-section">
        <h3 className="workspace-mask-section-heading">自动选择</h3>
        <div className="workspace-mask-auto-targets" aria-label="自动选择类型">
          {AUTOMATIC_SEGMENTATION_TARGETS.map((item) => {
            const Icon = TARGET_ICONS[item.id]
            const isRunning = runningTargetId === item.id
            const progress = isRunning ? mask.segmentationProgress : null
            const indeterminate = !progress || progress.percent === null
            return (
              <Button
                key={item.id}
                variant="ghost"
                className={[item.id === targetId ? 'is-active' : '', isRunning ? 'is-running' : ''].filter(Boolean).join(' ') || undefined}
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
          })}
        </div>
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
              <Button size="mini" variant="secondary" onClick={() => void startAutomaticSelection(targetId)}>重试</Button>
              <Button size="mini" variant="ghost" onClick={clearAutomaticSelectionError}>继续使用画笔</Button>
            </div>
          </div>
        )}
      </section>

      <Accordion title="画笔修补" defaultOpen>
        <div className="workspace-mask-editor-section">
          <div className="workspace-mask-mode-row">
            <strong>模式</strong>
            <ButtonGroup className="workspace-mask-brush-modes" options={BRUSH_MODES} value={mask.brushMode} onChange={(value) => mask.setBrushMode(value as 'paint' | 'erase')} />
          </div>
          <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={100} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}`} />
          <label className="workspace-mask-setting-row">
            <strong>显示选区</strong>
            <Switch ariaLabel="显示选区" checked={mask.showOverlay} onCheckedChange={mask.setShowOverlay} />
          </label>
        </div>
      </Accordion>

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

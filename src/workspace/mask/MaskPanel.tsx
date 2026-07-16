import { Brush, Cloud, Eraser, ScanSearch, TreePine, UserRound, Waves, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Accordion, Button, ButtonGroup, Dialog, Switch } from '../../ui'
import { AUTOMATIC_SEGMENTATION_TARGETS, SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS, type AutomaticSegmentationTargetId } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const TARGET_ICONS = { sky: Cloud, water: Waves, person: UserRound, subject: ScanSearch, tree: TreePine }
const BRUSH_MODES = [
  { value: 'paint', label: <><Brush size={18} />添加</> },
  { value: 'erase', label: <><Eraser size={18} />擦除</> },
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
  const [checkingModel, setCheckingModel] = useState(false)
  const [modelStatusError, setModelStatusError] = useState<string | null>(null)
  const [pendingDownload, setPendingDownload] = useState<{ modelId: typeof AUTOMATIC_SEGMENTATION_TARGETS[number]['modelId']; sizeBytes: number; targetId: AutomaticSegmentationTargetId } | null>(null)
  const confirmedDownloadsRef = useRef(new Set<string>())

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
    setModelStatusError(null)
    mask.clearSegmentationError()
  }

  const startAutomaticSelection = async (): Promise<void> => {
    if (mask.busy || checkingModel) return
    clearAutomaticSelectionError()
    setCheckingModel(true)
    try {
      const modelId = target.modelId
      const status = await window.luna.workspace.getSegmentationModelStatus(modelId)
      if (!status.cached && !confirmedDownloadsRef.current.has(modelId)) {
        setPendingDownload({ modelId, sizeBytes: status.sizeBytes, targetId: target.id })
        return
      }
      void mask.generateSemanticMask(undefined, target.id)
    } catch (error) {
      setModelStatusError(error instanceof Error ? error.message : '无法检查自动选择资源，请重试')
    } finally {
      setCheckingModel(false)
    }
  }

  const confirmDownload = (): void => {
    if (!pendingDownload) return
    confirmedDownloadsRef.current.add(pendingDownload.modelId)
    const confirmedTargetId = pendingDownload.targetId
    setPendingDownload(null)
    void mask.generateSemanticMask(undefined, confirmedTargetId)
  }

  const automaticSelectionError = modelStatusError ?? mask.segmentationError

  return (
    <div className="workspace-mask-panel">
      <section className="workspace-mask-auto-section">
        <h3 className="workspace-mask-section-heading">自动选择</h3>
        <div className="workspace-mask-auto-targets" aria-label="自动选择类型">
          {AUTOMATIC_SEGMENTATION_TARGETS.map((item) => {
            const Icon = TARGET_ICONS[item.id]
            return (
              <Button
                key={item.id}
                variant="ghost"
                className={item.id === targetId ? 'is-active' : undefined}
                disabled={mask.busy || checkingModel}
                onClick={() => setTargetId(item.id)}
              >
                <Icon size={20} />
                {item.label}
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
        {mask.segmentationProgress ? (
          <Button variant="secondary" className="workspace-mask-apply-button" onClick={mask.cancelSegmentation}>
            <X size={16} />
            取消自动选择
          </Button>
        ) : (
          <Button
            variant="primary"
            className="workspace-mask-apply-button"
            disabled={mask.busy || checkingModel || developerMode === null}
            onClick={() => void startAutomaticSelection()}
          >
            {checkingModel ? '正在检查' : mask.busy ? '正在处理' : '应用自动选择'}
          </Button>
        )}
        {mask.segmentationProgress && (
          <div className="workspace-mask-progress" aria-live="polite">
            <div><span>{mask.segmentationProgress.label}</span>{mask.segmentationProgress.percent !== null && <span>{mask.segmentationProgress.percent}%</span>}</div>
            <div className="workspace-mask-progress-track" role="progressbar" aria-label={mask.segmentationProgress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={mask.segmentationProgress.percent ?? undefined}>
              <span className={mask.segmentationProgress.percent === null ? 'is-indeterminate' : undefined} style={mask.segmentationProgress.percent === null ? undefined : { width: `${mask.segmentationProgress.percent}%` }} />
            </div>
          </div>
        )}
        {automaticSelectionError && !mask.segmentationProgress && (
          <div className="workspace-mask-auto-error" role="alert">
            <p>{automaticSelectionError}</p>
            <div>
              <Button size="mini" variant="secondary" onClick={() => void startAutomaticSelection()}>重试</Button>
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
            value={settings?.feather ?? 0}
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
      <Dialog
        open={pendingDownload !== null}
        onOpenChange={(open) => { if (!open) setPendingDownload(null) }}
        title="下载自动选择资源"
        description={pendingDownload ? `首次使用需要下载 ${formatModelSize(pendingDownload.sizeBytes)}，下载完成后会保存在本机。` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setPendingDownload(null)}>取消</Button>
          <Button variant="primary" onClick={confirmDownload}>下载并继续</Button>
        </>}
      />
    </div>
  )
}

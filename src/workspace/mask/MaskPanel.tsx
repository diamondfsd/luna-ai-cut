import { Brush, Cloud, Eraser, TreePine, UserRound, Waves } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Accordion, Button, ButtonGroup, Select, Switch } from '../../ui'
import { COMMON_SEGMENTATION_TARGETS, SAM_MODELS, SEGMENTATION_MODELS } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const MODELS = [...SEGMENTATION_MODELS, ...SAM_MODELS]
const AUTO_TARGETS = COMMON_SEGMENTATION_TARGETS.slice(0, 4)
const TARGET_ICONS = [Cloud, Waves, UserRound, TreePine]
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
  const initialTarget = AUTO_TARGETS.find((target) => target.classId === settings?.classId)?.classId ?? AUTO_TARGETS[0].classId
  const [targetClassId, setTargetClassId] = useState<number>(initialTarget)

  useEffect(() => {
    const classId = mask.activeMask?.classId
    if (classId !== undefined && AUTO_TARGETS.some((target) => target.classId === classId)) setTargetClassId(classId)
  }, [mask.activeMask?.classId])

  const target = useMemo(
    () => AUTO_TARGETS.find((item) => item.classId === targetClassId) ?? AUTO_TARGETS[0],
    [targetClassId],
  )

  return (
    <div className="workspace-mask-panel">
      <section className="workspace-mask-auto-section">
        <h3 className="workspace-mask-section-heading">自动选择</h3>
        <div className="workspace-mask-auto-targets" aria-label="自动选择类型">
          {AUTO_TARGETS.map((item, index) => {
            const Icon = TARGET_ICONS[index]
            return (
              <Button
                key={item.classId}
                variant="ghost"
                className={item.classId === targetClassId ? 'is-active' : undefined}
                disabled={mask.busy}
                onClick={() => setTargetClassId(item.classId)}
              >
                <Icon size={20} />
                {item.label.replace(' / 水面', '')}
              </Button>
            )
          })}
        </div>
        <label className="workspace-mask-model-field">
          <strong>模型</strong>
          <Select
            variant="compact"
            fullWidth
            value={mask.segmentationModel}
            disabled={mask.busy}
            onValueChange={(value) => mask.setSegmentationModel(value as typeof mask.segmentationModel)}
            options={MODELS.map((model) => ({
              value: model.id,
              label: `${model.name} · ${formatModelSize(model.sizeBytes)}`,
            }))}
          />
        </label>
        <Button
          variant="primary"
          className="workspace-mask-apply-button"
          disabled={mask.busy}
          onClick={() => void mask.generateSemanticMask(undefined, target.classId)}
        >
          {mask.busy ? mask.segmentationProgress?.label ?? '正在处理' : '应用自动选择'}
        </Button>
        {mask.segmentationProgress && (
          <div className="workspace-mask-progress" aria-live="polite">
            <div><span>{mask.segmentationProgress.label}</span>{mask.segmentationProgress.percent !== null && <span>{mask.segmentationProgress.percent}%</span>}</div>
            <div className="workspace-mask-progress-track" role="progressbar" aria-label={mask.segmentationProgress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={mask.segmentationProgress.percent ?? undefined}>
              <span className={mask.segmentationProgress.percent === null ? 'is-indeterminate' : undefined} style={mask.segmentationProgress.percent === null ? undefined : { width: `${mask.segmentationProgress.percent}%` }} />
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
        </div>
      </Accordion>

      <section className="workspace-mask-edge-section">
        <h3 className="workspace-mask-section-heading">边缘</h3>
        <div className="workspace-mask-editor-section">
          <ParamSlider label="羽化" value={settings?.feather ?? 0} min={0} max={100} onChange={(feather) => mask.updateMaskSettings({ feather })} formatValue={(value) => `${Math.round(value)}`} />
          <ParamSlider label="不透明度" value={Math.round((settings?.opacity ?? 1) * 100)} min={0} max={100} onChange={(opacity) => mask.updateMaskSettings({ opacity: opacity / 100 })} formatValue={(value) => `${Math.round(value)}`} />
          <label className="workspace-mask-setting-row">
            <strong>反相蒙版</strong>
            <Switch ariaLabel="反相蒙版" checked={settings?.inverted ?? false} disabled={!settings} onCheckedChange={(inverted) => mask.updateMaskSettings({ inverted })} />
          </label>
        </div>
      </section>
    </div>
  )
}

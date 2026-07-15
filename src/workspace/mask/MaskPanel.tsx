import { Brush, Eraser, Eye, EyeOff, Sparkles } from 'lucide-react'

import { Accordion, Button, ButtonGroup, Select, Switch } from '../../ui'
import { COMMON_SEGMENTATION_TARGETS, SAM_MODELS, SEGMENTATION_MODELS } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const MODELS = [...SEGMENTATION_MODELS, ...SAM_MODELS]
const BRUSH_MODES = [
  { value: 'paint', label: <><Brush size={14} />添加</> },
  { value: 'erase', label: <><Eraser size={14} />擦除</> },
]

function formatModelSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(2)} 秒`
}

export function MaskPanel() {
  const mask = useWorkspaceMask()
  const settings = mask.activeMask

  return (
    <div className="workspace-mask-panel">
      <section className="workspace-mask-auto-section">
        <div className="workspace-mask-section-heading"><Sparkles size={15} /><strong>自动选择</strong></div>
        <div className="workspace-mask-editor-section">
          <div className="workspace-mask-auto-targets">
            <div>
              {COMMON_SEGMENTATION_TARGETS.map((target) => (
                <Button key={target.classId} variant="ghost" size="mini" disabled={mask.busy} onClick={() => void mask.generateSemanticMask(undefined, target.classId)}>
                  {target.label}
                </Button>
              ))}
            </div>
          </div>
          <label className="workspace-mask-field">
            <span>识别模型</span>
            <Select
              variant="compact"
              fullWidth
              value={mask.segmentationModel}
              disabled={mask.busy}
              onValueChange={(value) => mask.setSegmentationModel(value as typeof mask.segmentationModel)}
              options={MODELS.map((model) => ({
                value: model.id,
                label: `${model.name} · ${model.description} · ${formatModelSize(model.sizeBytes)}`,
              }))}
            />
          </label>
          <Button
            variant="primary"
            size="compact"
            icon={<Sparkles size={15} />}
            disabled={mask.busy}
            onClick={() => mask.setSemanticPicking(true)}
          >
            {mask.busy ? mask.segmentationProgress?.label ?? '正在处理中' : '开始点选对象'}
          </Button>
          {mask.segmentationProgress && (
            <div className="workspace-mask-progress" aria-live="polite">
              <div><span>{mask.segmentationProgress.label}</span>{mask.segmentationProgress.percent !== null && <span>{mask.segmentationProgress.percent}%</span>}</div>
              <div className="workspace-mask-progress-track" role="progressbar" aria-label={mask.segmentationProgress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={mask.segmentationProgress.percent ?? undefined}>
                <span className={mask.segmentationProgress.percent === null ? 'is-indeterminate' : undefined} style={mask.segmentationProgress.percent === null ? undefined : { width: `${mask.segmentationProgress.percent}%` }} />
              </div>
            </div>
          )}
          {mask.lastSegmentationPerformance && (
            <div className="workspace-mask-performance">
              <span>模型 {formatDuration(mask.lastSegmentationPerformance.modelLoadMs)}</span>
              <span>识别 {formatDuration(mask.lastSegmentationPerformance.inferenceMs)}</span>
              <strong>总计 {formatDuration(mask.lastSegmentationPerformance.totalMs)}</strong>
            </div>
          )}
        </div>
      </section>

      <Accordion title={<span className="workspace-mask-accordion-title"><Brush size={14} />画笔修补</span>} defaultOpen>
        <div className="workspace-mask-editor-section">
          <ButtonGroup options={BRUSH_MODES} value={mask.brushMode} onChange={(value) => mask.setBrushMode(value as 'paint' | 'erase')} />
          <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={30} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}%`} />
          <Button variant="secondary" size="compact" icon={mask.showOverlay ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => mask.setShowOverlay(!mask.showOverlay)}>
            {mask.showOverlay ? '隐藏选区提示' : '显示选区提示'}
          </Button>
        </div>
      </Accordion>

      <Accordion title="边缘" modified={(settings?.feather ?? 0) > 0 || (settings?.opacity ?? 1) < 1 || settings?.inverted === true}>
        <div className="workspace-mask-editor-section">
          <ParamSlider label="羽化" value={settings?.feather ?? 0} min={0} max={40} onChange={(feather) => mask.updateMaskSettings({ feather })} formatValue={(value) => `${Math.round(value)} px`} />
          <ParamSlider label="不透明度" value={Math.round((settings?.opacity ?? 1) * 100)} min={0} max={100} onChange={(opacity) => mask.updateMaskSettings({ opacity: opacity / 100 })} formatValue={(value) => `${Math.round(value)}%`} />
          <label className="workspace-mask-setting-row">
            <strong>反向蒙版</strong>
            <Switch ariaLabel="反向蒙版" checked={settings?.inverted ?? false} disabled={!settings} onCheckedChange={(inverted) => mask.updateMaskSettings({ inverted })} />
          </label>
        </div>
      </Accordion>
    </div>
  )
}

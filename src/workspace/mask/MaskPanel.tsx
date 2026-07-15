import { Brush, Eraser, Eye, EyeOff, MousePointer2, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, ButtonGroup, PillTabs, Select, Switch } from '../../ui'
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
  const [section, setSection] = useState('smart')
  const selectedModel = MODELS.find((model) => model.id === mask.segmentationModel)

  return (
    <div className="workspace-mask-panel">
      <PillTabs
        value={section}
        onValueChange={setSection}
        className="workspace-mask-editor-tabs"
        items={[
          { value: 'smart', label: '智能选择' },
          { value: 'brush', label: '画笔修补' },
          { value: 'edge', label: '边缘调整' },
        ]}
      />

      {section === 'smart' && (
        <div className="workspace-mask-editor-section">
          <div className="workspace-mask-step-card">
            <span className="workspace-mask-step-icon"><MousePointer2 size={18} /></span>
            <div><strong>点击画面中的对象</strong><span>应用会识别点击位置并生成蒙版</span></div>
          </div>
          <div className="workspace-mask-auto-targets">
            <span>无需点击，直接选择常用主体</span>
            <div>
              {COMMON_SEGMENTATION_TARGETS.map((target) => (
                <Button key={target.classId} variant="ghost" size="mini" disabled={mask.busy} onClick={() => void mask.generateSemanticMask(undefined, target.classId)}>
                  {target.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="workspace-mask-or"><span>或点选任意对象</span></div>
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
          {selectedModel && <span className="workspace-mask-model-note">输入 {selectedModel.inputSize}×{selectedModel.inputSize}，首次使用会自动下载</span>}
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
      )}

      {section === 'brush' && (
        <div className="workspace-mask-editor-section">
          <div className="workspace-mask-step-card">
            <span className="workspace-mask-step-icon"><Brush size={18} /></span>
            <div><strong>直接在画面上涂抹</strong><span>添加遗漏区域，或擦除多余选区</span></div>
          </div>
          <ButtonGroup options={BRUSH_MODES} value={mask.brushMode} onChange={(value) => mask.setBrushMode(value as 'paint' | 'erase')} />
          <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={30} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}%`} />
          <Button variant="secondary" size="compact" icon={mask.showOverlay ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => mask.setShowOverlay(!mask.showOverlay)}>
            {mask.showOverlay ? '隐藏选区提示' : '显示选区提示'}
          </Button>
        </div>
      )}

      {section === 'edge' && (
        <div className="workspace-mask-editor-section">
          <ParamSlider label="羽化" value={settings?.feather ?? 0} min={0} max={40} onChange={(feather) => mask.updateMaskSettings({ feather })} formatValue={(value) => `${Math.round(value)} px`} />
          <ParamSlider label="不透明度" value={Math.round((settings?.opacity ?? 1) * 100)} min={0} max={100} onChange={(opacity) => mask.updateMaskSettings({ opacity: opacity / 100 })} formatValue={(value) => `${Math.round(value)}%`} />
          <label className="workspace-mask-setting-row">
            <span><strong>反向蒙版</strong><small>交换选中与未选中的区域</small></span>
            <Switch ariaLabel="反向蒙版" checked={settings?.inverted ?? false} disabled={!settings} onCheckedChange={(inverted) => mask.updateMaskSettings({ inverted })} />
          </label>
        </div>
      )}
    </div>
  )
}

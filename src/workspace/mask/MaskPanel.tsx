import { Brush, Eraser, Eye, EyeOff, Sparkles, Trash2 } from 'lucide-react'

import { Button, ButtonGroup, IconButton, Switch, Tooltip } from '../../ui'
import { SAM_MODELS, SEGMENTATION_MODELS } from '../../shared/segmentationModels'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const BRUSH_MODES = [
  { value: 'paint', label: <><Brush size={14} />添加</> },
  { value: 'erase', label: <><Eraser size={14} />移除</> },
]

function formatModelSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(2)} 秒`
}

export function MaskPanel() {
  const mask = useWorkspaceMask()
  const settings = mask.activeMask

  return (
    <div className="workspace-mask-panel">
      <div className="workspace-mask-smart-row">
        <Button
          variant="primary"
          size="compact"
          icon={<Sparkles size={15} />}
          disabled={mask.busy}
          onClick={() => {
            mask.setEditing(true)
            mask.setSemanticPicking(true)
          }}
        >
          {mask.busy ? mask.segmentationProgress?.label ?? '正在处理中' : '智能选择'}
        </Button>
        <span>{settings?.kind === 'semantic' ? settings.className ?? '已选择区域' : '点击画面选择区域'}</span>
      </div>
      {mask.segmentationProgress && (
        <div className="workspace-mask-progress" aria-live="polite">
          <div>
            <span>{mask.segmentationProgress.label}</span>
            {mask.segmentationProgress.percent !== null && <span>{mask.segmentationProgress.percent}%</span>}
          </div>
          <div
            className="workspace-mask-progress-track"
            role="progressbar"
            aria-label={mask.segmentationProgress.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={mask.segmentationProgress.percent ?? undefined}
          >
            <span
              className={mask.segmentationProgress.percent === null ? 'is-indeterminate' : undefined}
              style={mask.segmentationProgress.percent === null ? undefined : { width: `${mask.segmentationProgress.percent}%` }}
            />
          </div>
        </div>
      )}
      <div className="workspace-mask-models" aria-label="识别模型">
        <span className="workspace-mask-section-label">识别模型</span>
        <div className="workspace-mask-model-list">
          {[...SEGMENTATION_MODELS, ...SAM_MODELS].map((model) => (
            <Button
              key={model.id}
              variant={mask.segmentationModel === model.id ? 'primary' : 'secondary'}
              className="workspace-mask-model-option"
              disabled={mask.busy}
              onClick={() => mask.setSegmentationModel(model.id)}
            >
              <span>{model.name}</span>
              <span>{model.description} · {formatModelSize(model.sizeBytes)} · {model.inputSize}×{model.inputSize}</span>
            </Button>
          ))}
        </div>
      </div>
      {mask.lastSegmentationPerformance && (
        <div className="workspace-mask-performance" aria-label="最近一次识别耗时">
          <span className="workspace-mask-section-label">最近一次识别</span>
          <dl>
            <div><dt>模型准备</dt><dd>{formatDuration(mask.lastSegmentationPerformance.modelLoadMs)}</dd></div>
            <div><dt>图像准备</dt><dd>{formatDuration(mask.lastSegmentationPerformance.imagePrepareMs)}</dd></div>
            <div><dt>识别</dt><dd>{formatDuration(mask.lastSegmentationPerformance.inferenceMs)}</dd></div>
            <div><dt>总耗时</dt><dd>{formatDuration(mask.lastSegmentationPerformance.totalMs)}</dd></div>
          </dl>
        </div>
      )}

      <ButtonGroup
        options={BRUSH_MODES}
        value={mask.brushMode}
        onChange={(value) => mask.setBrushMode(value as 'paint' | 'erase')}
      />
      <ParamSlider label="画笔大小" value={mask.brushSize} min={1} max={30} onChange={mask.setBrushSize} formatValue={(value) => `${Math.round(value)}%`} />
      <ParamSlider
        label="羽化"
        value={settings?.feather ?? 0}
        min={0}
        max={40}
        onChange={(feather) => mask.updateMaskSettings({ feather })}
        formatValue={(value) => `${Math.round(value)} px`}
      />
      <ParamSlider
        label="不透明度"
        value={Math.round((settings?.opacity ?? 1) * 100)}
        min={0}
        max={100}
        onChange={(opacity) => mask.updateMaskSettings({ opacity: opacity / 100 })}
        formatValue={(value) => `${Math.round(value)}%`}
      />

      <label className="workspace-mask-setting-row">
        <span>反选蒙版</span>
        <Switch ariaLabel="反选蒙版" checked={settings?.inverted ?? false} onCheckedChange={(inverted) => mask.updateMaskSettings({ inverted })} />
      </label>

      <div className="workspace-mask-actions">
        <Button
          variant="secondary"
          size="compact"
          icon={mask.showOverlay ? <EyeOff size={14} /> : <Eye size={14} />}
          onClick={() => mask.setShowOverlay(!mask.showOverlay)}
        >
          {mask.showOverlay ? '隐藏蒙版' : '显示蒙版'}
        </Button>
        <Tooltip content="删除蒙版">
          <IconButton
            variant="ghost"
            size="compact"
            icon={<Trash2 size={15} />}
            disabled={!settings}
            onClick={() => void mask.removeMask()}
            aria-label="删除蒙版"
          />
        </Tooltip>
      </div>
    </div>
  )
}

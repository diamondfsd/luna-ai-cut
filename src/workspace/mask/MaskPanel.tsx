import { Brush, Eraser, Eye, EyeOff, Sparkles, Trash2 } from 'lucide-react'

import { Button, ButtonGroup, IconButton, Switch, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskPanel.css'

const BRUSH_MODES = [
  { value: 'paint', label: <><Brush size={14} />添加</> },
  { value: 'erase', label: <><Eraser size={14} />移除</> },
]

export function MaskPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const settings = edit.pipeline.colorMask

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
          {mask.busy ? '正在识别' : '智能选择'}
        </Button>
        <span>{settings?.kind === 'semantic' ? settings.className ?? '已选择区域' : '点击画面选择区域'}</span>
      </div>

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

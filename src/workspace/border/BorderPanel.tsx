import { RotateCcw } from 'lucide-react'
import { useMemo } from 'react'

import { Input, Switch } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import type { EditPipeline } from '../shared/editPipeline'
import { BorderItem } from './BorderItem'
import { FRAME_PRESETS } from './buildBorderLayer'
import '../../styles/workspace-border.css'

interface BorderPanelProps {
  value: EditPipeline['border']
  onChange: (patch: Partial<EditPipeline['border']>) => void
  /** 当前素材路径（传给 BorderItem 渲染边框缩略图） */
  mediaPath?: string | null
}

export function presetColors(presetId: string): { backgroundColor: string; textColor: string } {
  const preset = FRAME_PRESETS.find((item) => item.id === presetId)
  const background = preset?.layers?.find((layer) => layer.type === 'shape' && layer.id === 'background')
  const text = preset?.layers?.find((layer) => layer.type === 'text')
  return {
    backgroundColor: background?.type === 'shape' ? background.fill?.color ?? preset?.swatch ?? '#ffffff' : preset?.swatch ?? '#ffffff',
    textColor: text?.type === 'text' ? text.style.color : '#222222',
  }
}

export function BorderPanel({ value, onChange, mediaPath }: BorderPanelProps) {
  const activePresetInfo = useMemo(
    () => FRAME_PRESETS.find((p) => p.id === value.presetId) ?? null,
    [value.presetId],
  )

  // 检测当前预设是否有层使用了 {{title}} 占位符
  const hasTitlePlaceholder = activePresetInfo?.layers?.some(
    (l) => l.type === 'text' && l.content?.includes('{{title}}'),
  ) ?? false

  const handleSelect = (presetId: string) => {
    if (presetId === value.presetId && value.enabled) {
      // 再次点击已选的预设 → 取消选中
      onChange({ enabled: false })
      return
    }
    onChange({ enabled: true, presetId, ...presetColors(presetId) })
  }

  return (
    <div className="workspace-border-panel">
      {/* ── 当前边框卡片（有选中预设时显示） ── */}
      {value.enabled && activePresetInfo && (
        <section className="border-current-card">
          <div className="border-current-preview">
            <BorderItem
              presetId={value.presetId}
              name={activePresetInfo.name}
              mediaPath={mediaPath ?? null}
              hideName
            />
          </div>
          <div className="border-current-info">
            <div className="border-current-top">
              <span className="border-current-name">{activePresetInfo.name}</span>
              <button
                className="border-reset"
                onClick={() => onChange({ enabled: false })}
                title="取消边框"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          </div>

          {/* ── 编辑控件 ── */}
          <div className="border-edit-controls">
            <span className="border-edit-section-title">微调</span>

            <div className="border-color-row">
              <span>背景颜色</span>
              <label className="border-color-picker">
                <input
                  type="color"
                  value={value.backgroundColor}
                  onChange={(e) => onChange({ backgroundColor: e.currentTarget.value })}
                />
                <span className="border-color-swatch" style={{ background: value.backgroundColor }} />
                <span>{value.backgroundColor}</span>
              </label>
            </div>

            <div className="border-color-row">
              <span>文字颜色</span>
              <label className="border-color-picker">
                <input
                  type="color"
                  value={value.textColor}
                  onChange={(e) => onChange({ textColor: e.currentTarget.value })}
                />
                <span className="border-color-swatch" style={{ background: value.textColor }} />
                <span>{value.textColor}</span>
              </label>
            </div>

            <ParamSlider
              label="边框尺寸"
              value={value.frameSize}
              min={70}
              max={135}
              step={1}
              onChange={(frameSize) => onChange({ frameSize })}
              formatValue={(v) => `${v}%`}
            />

            <ParamSlider
              label="不透明度"
              value={value.opacity}
              min={20}
              max={100}
              step={1}
              onChange={(opacity) => onChange({ opacity })}
              formatValue={(v) => `${v}%`}
            />

            {hasTitlePlaceholder && (
              <div className="border-title-row">
                <span className="border-title-label">标题</span>
                <Input
                  variant="pill"
                  fullWidth
                  value={value.title}
                  onChange={(e) => onChange({ title: e.currentTarget.value })}
                  placeholder="输入作品标题"
                  aria-label="作品标题"
                />
              </div>
            )}

            <div className="border-switches">
              <label>
                <span>显示标志</span>
                <Switch
                  checked={value.showLogo}
                  onCheckedChange={(showLogo) => onChange({ showLogo })}
                  ariaLabel="显示标志"
                />
              </label>
              <label>
                <span>显示标题</span>
                <Switch
                  checked={value.showTitle}
                  onCheckedChange={(showTitle) => onChange({ showTitle })}
                  ariaLabel="显示标题"
                />
              </label>
              <label>
                <span>显示拍摄信息</span>
                <Switch
                  checked={value.showCameraInfo}
                  onCheckedChange={(showCameraInfo) => onChange({ showCameraInfo })}
                  ariaLabel="显示拍摄信息"
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* ── 预设网格 ── */}
      <div className="border-grid-wrap">
        <div className="border-grid">
          {FRAME_PRESETS.map((preset) => (
            <BorderItem
              key={preset.id}
              presetId={preset.id}
              name={preset.name}
              active={value.enabled && value.presetId === preset.id}
              onClick={() => handleSelect(preset.id)}
              mediaPath={mediaPath ?? null}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

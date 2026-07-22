import { ArrowLeft, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { isVideoPath } from '../../lib/fileUtils'
import { IconButton, Input, SearchField, Switch } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import { DEFAULT_PIPELINE, type EditPipeline } from '../shared/editPipeline'
import { BorderItem } from './BorderItem'
import { FRAME_PRESETS } from './buildBorderLayer'
import '../../styles/workspace-border.css'

interface BorderPanelProps {
  value: EditPipeline['border']
  onChange: (patch: Partial<EditPipeline['border']>) => void
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
  const [view, setView] = useState<'list' | 'edit'>(() => value.enabled ? 'edit' : 'list')
  const [query, setQuery] = useState('')
  const activePreset = useMemo(
    () => FRAME_PRESETS.find((preset) => preset.id === value.presetId) ?? null,
    [value.presetId],
  )
  const filteredPresets = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    if (!keyword) return FRAME_PRESETS
    return FRAME_PRESETS.filter((preset) =>
      [preset.name, preset.description, preset.category].some((field) => field?.toLocaleLowerCase().includes(keyword)),
    )
  }, [query])
  const hasTitle = activePreset?.layers.some((layer) => layer.type === 'text' && layer.content.includes('{{title}}')) ?? false
  const hasLogo = activePreset?.layers.some((layer) => layer.type === 'logo') ?? false
  const hasDate = activePreset?.layers.some((layer) => layer.type === 'text' && layer.content.includes('{{date}}')) ?? false
  const isVideoMedia = mediaPath ? isVideoPath(mediaPath) : false
  const isBlurredPhotoCard = activePreset?.id === 'blurred-photo-card'

  // 素材切换及其 pipeline 初始化完成后，按该素材是否已有边框决定入口。
  useEffect(() => {
    setView(value.enabled ? 'edit' : 'list')
  }, [mediaPath, value.enabled, value.presetId])

  const selectPreset = (presetId: string) => {
    const preset = FRAME_PRESETS.find((item) => item.id === presetId)
    onChange({
      enabled: true,
      presetId,
      ...presetColors(presetId),
      ...(preset?.defaultTitle ? { title: preset.defaultTitle } : {}),
      ...(presetId === 'blurred-photo-card' ? { frameSize: 104 } : {}),
      mediaScale: 100,
      mediaOffsetX: 0,
      mediaOffsetY: 0,
      shadowStrength: DEFAULT_PIPELINE.border.shadowStrength,
      shadowBlur: presetId === 'blurred-photo-card' ? 20 : DEFAULT_PIPELINE.border.shadowBlur,
      shadowOffsetY: DEFAULT_PIPELINE.border.shadowOffsetY,
      showDate: true,
    })
    setView('edit')
  }

  const resetPreset = () => onChange({
    ...DEFAULT_PIPELINE.border,
    enabled: true,
    presetId: value.presetId,
    ...presetColors(value.presetId),
    ...(activePreset?.defaultTitle ? { title: activePreset.defaultTitle } : {}),
    ...(activePreset?.id === 'blurred-photo-card' ? { frameSize: 104, shadowStrength: 50, shadowBlur: 20 } : {}),
  })

  if (view === 'edit' && activePreset) {
    return (
      <div className="workspace-border-panel border-editor-view">
        <header className="border-panel-header">
          <IconButton variant="ghost" size="mini" icon={<ArrowLeft size={17} />} onClick={() => setView('list')} aria-label="返回边框列表" />
          <div><strong>{activePreset.name}</strong><span>{activePreset.description}</span></div>
          <div className="border-panel-actions">
            <IconButton
              variant="ghost"
              size="mini"
              icon={<X size={16} />}
              onClick={() => {
                onChange({ enabled: false })
                setView('list')
              }}
              aria-label="移除当前边框"
              title="移除当前边框"
            />
            <IconButton variant="ghost" size="mini" icon={<RotateCcw size={15} />} onClick={resetPreset} aria-label="还原边框设置" title="还原边框设置" />
          </div>
        </header>

        <div className="border-editor-scroll">
          <section className="border-edit-controls">
            {hasTitle && (
              <div className="border-title-row">
                <span className="border-title-label">标题</span>
                <Input variant="compact" fullWidth value={value.title} onChange={(event) => onChange({ title: event.currentTarget.value })} placeholder="输入作品标题" aria-label="作品标题" />
              </div>
            )}

            <div className="border-edit-section-title">外观</div>
            <div className="border-color-row">
              <span>边框颜色</span>
              <label className="border-color-picker">
                <input type="color" value={value.backgroundColor} onChange={(event) => onChange({ backgroundColor: event.currentTarget.value })} />
                <span className="border-color-swatch" style={{ background: value.backgroundColor }} />
                <span>{value.backgroundColor.toUpperCase()}</span>
              </label>
            </div>
            <div className="border-color-row">
              <span>文字颜色</span>
              <label className="border-color-picker">
                <input type="color" value={value.textColor} onChange={(event) => onChange({ textColor: event.currentTarget.value })} />
                <span className="border-color-swatch" style={{ background: value.textColor }} />
                <span>{value.textColor.toUpperCase()}</span>
              </label>
            </div>
            <ParamSlider label="边框尺寸" value={value.frameSize} min={70} max={isBlurredPhotoCard ? 110 : 135} step={1} onChange={(frameSize) => onChange({ frameSize })} formatValue={(number) => `${number}%`} />
            <ParamSlider label="不透明度" value={value.opacity} min={20} max={100} step={1} onChange={(opacity) => onChange({ opacity })} formatValue={(number) => `${number}%`} />

            {!isBlurredPhotoCard && <div className="border-media-controls">
              <div className="border-edit-section-title">素材布局</div>
              <ParamSlider label="素材尺寸" value={value.mediaScale} min={70} max={160} step={1} onChange={(mediaScale) => onChange({ mediaScale })} formatValue={(number) => `${number}%`} />
              <ParamSlider label="水平位置" value={value.mediaOffsetX} min={-50} max={50} step={1} onChange={(mediaOffsetX) => onChange({ mediaOffsetX })} formatValue={(number) => `${number}`} />
              <ParamSlider label="垂直位置" value={value.mediaOffsetY} min={-50} max={50} step={1} onChange={(mediaOffsetY) => onChange({ mediaOffsetY })} formatValue={(number) => `${number}`} />
            </div>}

            {isBlurredPhotoCard && <div className="border-media-controls">
              <div className="border-edit-section-title">主图阴影</div>
              <ParamSlider label="阴影强度" value={value.shadowStrength} min={0} max={100} step={1} onChange={(shadowStrength) => onChange({ shadowStrength })} formatValue={(number) => `${number}%`} />
              <ParamSlider label="柔和范围" value={value.shadowBlur} min={0} max={100} step={1} onChange={(shadowBlur) => onChange({ shadowBlur })} formatValue={(number) => `${number}%`} />
            </div>}

            <div className="border-switches">
              {hasLogo && <label><span>显示标志</span><Switch checked={value.showLogo} onCheckedChange={(showLogo) => onChange({ showLogo })} ariaLabel="显示标志" /></label>}
              {hasTitle && <label><span>显示标题</span><Switch checked={value.showTitle} onCheckedChange={(showTitle) => onChange({ showTitle })} ariaLabel="显示标题" /></label>}
              {!isVideoMedia && <label><span>显示拍摄信息</span><Switch checked={value.showCameraInfo} onCheckedChange={(showCameraInfo) => onChange({ showCameraInfo })} ariaLabel="显示拍摄信息" /></label>}
              {!isVideoMedia && hasDate && <label><span>显示拍摄日期</span><Switch checked={value.showDate} onCheckedChange={(showDate) => onChange({ showDate })} ariaLabel="显示拍摄日期" /></label>}
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace-border-panel border-list-view">
      <SearchField fullWidth value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索边框" aria-label="搜索边框" />
      <div className="border-grid-wrap">
        {filteredPresets.length ? (
          <div className="border-grid">
            {filteredPresets.map((preset) => (
              <BorderItem key={preset.id} presetId={preset.id} name={preset.name} active={value.enabled && value.presetId === preset.id} onClick={() => selectPreset(preset.id)} mediaPath={mediaPath ?? null} />
            ))}
          </div>
        ) : <div className="border-empty">没有找到相关边框</div>}
      </div>
    </div>
  )
}

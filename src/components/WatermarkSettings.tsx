import { useCallback, useMemo } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import type { DeviceWatermarkStyleConfig, WatermarkSettings as WatermarkSettingsType, WatermarkPosition, WatermarkStyle } from '../shared/types'

interface WatermarkSettingsProps {
  settings: WatermarkSettingsType
  onChange: (settings: WatermarkSettingsType) => void
  compact?: boolean
  showToggle?: boolean
  styleOptions?: DeviceWatermarkStyleConfig[]
}

const H_OPTIONS = [
  { value: 'left' as const, label: '左' },
  { value: 'center' as const, label: '中' },
  { value: 'right' as const, label: '右' },
]

const V_OPTIONS = [
  { value: 'top' as const, label: '上' },
  { value: 'bottom' as const, label: '下' },
]

/** 默认样式选项（无设备配置时兜底） */
const DEFAULT_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'luna_ultra', label: '标准' },
  { value: 'luna_ultra_cn', label: '中文' },
]

function WatermarkSettingsContent({ settings, styleOptions, onStyleChange, onPercentChange, onHPosChange, onVPosChange }: {
  settings: WatermarkSettingsType
  styleOptions?: DeviceWatermarkStyleConfig[]
  onStyleChange: (v: string) => void
  onPercentChange: (v: number) => void
  onHPosChange: (v: string) => void
  onVPosChange: (v: string) => void
}) {
  const stylePills = useMemo(() => {
    if (styleOptions && styleOptions.length > 0) {
      return styleOptions.map((opt) => ({
        value: opt.value,
        label: opt.label,
      }))
    }
    return DEFAULT_STYLE_OPTIONS
  }, [styleOptions])

  const [vPos, hPos] = (settings.position ?? 'bottom-center').split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="video-export-setting-row">
        <span className="video-export-setting-label">水印样式</span>
        <SegmentedControl
          ariaLabel="水印样式"
          options={stylePills}
          value={settings.style}
          onChange={onStyleChange}
          variant="size"
        />
      </div>
      <div className="video-export-setting-row">
        <span className="video-export-setting-label">水印大小 {settings.watermarkPercent}%</span>
        <input
          type="range"
          min={1}
          max={40}
          value={settings.watermarkPercent}
          onChange={(e) => onPercentChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#0066cc' }}
        />
      </div>
      <div className="video-export-setting-row">
        <span className="video-export-setting-label">水平位置</span>
        <SegmentedControl
          ariaLabel="水平位置"
          options={H_OPTIONS}
          value={hPos}
          onChange={onHPosChange}
          variant="size"
        />
      </div>
      <div className="video-export-setting-row">
        <span className="video-export-setting-label">垂直位置</span>
        <SegmentedControl
          ariaLabel="垂直位置"
          options={V_OPTIONS}
          value={vPos}
          onChange={onVPosChange}
          variant="size"
        />
      </div>
    </div>
  )
}

export function WatermarkSettings({ settings, onChange, compact, showToggle = true, styleOptions }: WatermarkSettingsProps) {
  const handleToggle = useCallback(
    (enabled: boolean) => {
      onChange({ ...settings, enabled })
    },
    [settings, onChange],
  )

  const handleStyleChange = useCallback(
    (style: string) => {
      onChange({ ...settings, style: style as WatermarkStyle })
    },
    [settings, onChange],
  )

  const handlePercentChange = useCallback(
    (watermarkPercent: number) => {
      onChange({ ...settings, watermarkPercent })
    },
    [settings, onChange],
  )

  const handleHPosChange = useCallback(
    (h: string) => {
      const vPos = (settings.position ?? 'bottom-center').split('-')[0] || 'bottom'
      onChange({ ...settings, position: `${vPos}-${h}` as WatermarkPosition })
    },
    [settings, onChange],
  )

  const handleVPosChange = useCallback(
    (v: string) => {
      const hPos = (settings.position ?? 'bottom-center').split('-')[1] || 'center'
      onChange({ ...settings, position: `${v}-${hPos}` as WatermarkPosition })
    },
    [settings, onChange],
  )

  if (compact) {
    return (
      <div className="watermark-toolbar">
        <label className="watermark-toolbar-toggle">
          <Switch checked={settings.enabled} onCheckedChange={handleToggle} ariaLabel="启用水印" />
          <ImagePlus size={14} />
          <span>水印</span>
        </label>
        {settings.enabled && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="watermark-settings-btn" title="水印参数设置">
                <Settings2 size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="watermark-popover" align="start" sideOffset={6}>
              <div data-popover-header>水印参数</div>
              <WatermarkSettingsContent
                settings={settings}
                styleOptions={styleOptions}
                onStyleChange={handleStyleChange}
                onPercentChange={handlePercentChange}
                onHPosChange={handleHPosChange}
                onVPosChange={handleVPosChange}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    )
  }

  return (
    <section>
      {showToggle && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ImagePlus size={14} />
            水印设置
          </span>
          <Switch checked={settings.enabled} onCheckedChange={handleToggle} ariaLabel="启用水印" />
        </div>
      )}
      {(!showToggle || settings.enabled) && (
        <WatermarkSettingsContent
          settings={settings}
          styleOptions={styleOptions}
          onStyleChange={handleStyleChange}
          onPercentChange={handlePercentChange}
          onHPosChange={handleHPosChange}
          onVPosChange={handleVPosChange}
        />
      )}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { luna_ultra_layout, STYLE_TO_THEME } from '../shared/watermark/layoutConfig'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { WatermarkPosition, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import '../styles/watermark-settings.css'

const POSITIONS: Array<{ value: string; label: string; cx: number; cy: number }> = [
  { value: 'TopLeft', label: '左上', cx: 27, cy: 22.5 },
  { value: 'TopRight', label: '右上', cx: 133, cy: 22.5 },
  { value: 'BottomLeft', label: '左下', cx: 27, cy: 67.5 },
  { value: 'BottomCenter', label: '底中', cx: 80, cy: 67.5 },
  { value: 'BottomRight', label: '右下', cx: 133, cy: 67.5 },
]

interface WatermarkSettingsProps {
  settings: WatermarkSettingsType
  onChange: (settings: WatermarkSettingsType) => void
  compact?: boolean
  showToggle?: boolean
  /** 传文件路径即可自动按设备过滤水印样式 */
  filePath?: string
}

function WatermarkSettingsContent({ stylePills, settings, onStyleChange, onPositionChange }: {
  stylePills: Array<{ value: string; label: React.ReactNode }>
  settings: WatermarkSettingsType
  onStyleChange: (v: string) => void
  onPositionChange: (v: string) => void
}) {
  // 加载水印图片获取实际长宽比
  const [wmSize, setWmSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    const src = WM_SRC[settings.style]?.image
    if (!src) { setWmSize(null); return }
    const img = new Image()
    img.onload = () => { if (!cancelled) setWmSize({ w: img.naturalWidth, h: img.naturalHeight }) }
    img.onerror = () => { if (!cancelled) setWmSize(null) }
    img.src = src
    return () => { cancelled = true }
  }, [settings.style])

  // 从 WATERMARK_LAYOUT 中直接查找当前设置的参数
  useEffect(() => {
    if (!settings.enabled) return
    const theme = STYLE_TO_THEME[settings.style]
    if (!theme) return
    const key = `${theme}|16:9|${settings.position}`
    const ratios = luna_ultra_layout[key]
    console.log('[WatermarkSettings] WATERMARK_LAYOUT 查找:', { key, ratios, wmSize })
  }, [settings.enabled, settings.style, settings.position, wmSize])

  // 在 160×90 视口中计算水印预览矩形
  const wmPreview = useMemo(() => {
    if (!wmSize) return null
    const aspect = wmSize.w / wmSize.h
    const maxArea = 1400 // 约 50×28 的像素面积
    let w = Math.sqrt(maxArea * aspect)
    let h = w / aspect
    if (w > 50) { w = 50; h = w / aspect }
    if (h > 28) { h = 28; w = h * aspect }
    return { w, h }
  }, [wmSize])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {stylePills.length > 0 && (
        <SegmentedControl
          ariaLabel="水印样式"
          options={stylePills}
          value={settings.style}
          onChange={onStyleChange}
          variant="size"
          className="size-switch wm-style-selector"
        />
      )}

      <div className="wm-position-grid">
        <div className="wm-position-row">
          <button key={POSITIONS[0].value}
            className={`wm-pos-cell ${settings.position === POSITIONS[0].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[0].value)} title={POSITIONS[0].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame">
              {wmPreview && <rect x={POSITIONS[0].cx - wmPreview.w / 2} y={POSITIONS[0].cy - wmPreview.h / 2} width={wmPreview.w} height={wmPreview.h} fill="currentColor" rx={2} opacity={0.4} />}
            </svg>
          </button>
          <div className="wm-pos-cell wm-pos-placeholder" />
          <button key={POSITIONS[1].value}
            className={`wm-pos-cell ${settings.position === POSITIONS[1].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[1].value)} title={POSITIONS[1].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame">
              {wmPreview && <rect x={POSITIONS[1].cx - wmPreview.w / 2} y={POSITIONS[1].cy - wmPreview.h / 2} width={wmPreview.w} height={wmPreview.h} fill="currentColor" rx={2} opacity={0.4} />}
            </svg>
          </button>
        </div>
        <div className="wm-position-row">
          {POSITIONS.slice(2).map(pos => (
            <button key={pos.value}
              className={`wm-pos-cell ${settings.position === pos.value ? 'active' : ''}`}
              onClick={() => onPositionChange(pos.value)} title={pos.label}>
              <svg viewBox="0 0 160 90" className="wm-pos-frame">
                {wmPreview && <rect x={pos.cx - wmPreview.w / 2} y={pos.cy - wmPreview.h / 2} width={wmPreview.w} height={wmPreview.h} fill="currentColor" rx={2} opacity={0.4} />}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function WatermarkSettings({ settings, onChange, compact, showToggle = true, filePath }: WatermarkSettingsProps) {
  // 从文件路径自动检测设备 → 水印样式选项
  const [deviceId, setDeviceId] = useState<string | null>(null)
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    resolveDeviceId(
      { sourceDeviceId: null, cameraType: null, sourceDeviceName: null, cameraSerial: null, watermarkProfileId: null },
      { filePath, readExif: window.luna.readExifModel.bind(window.luna) },
    ).then((id) => { if (!cancelled) setDeviceId(id) }).catch(() => {})
    return () => { cancelled = true }
  }, [filePath])

  const stylePills = useMemo(() => {
    const opts = deviceId ? watermarkStyleOptionsForDevice(deviceId) : watermarkStyleOptionsForDevice('luna-ultra')
    return opts.map((opt) => {
      const thumbSrc = WM_SRC[opt.value]?.image
      return {
        value: opt.value,
        label: thumbSrc ? <img src={thumbSrc} alt={opt.label} className="wm-style-thumb" /> : opt.label,
      }
    })
  }, [deviceId])

  const handleToggle = useCallback(
    (enabled: boolean) => onChange({ ...settings, enabled }),
    [settings, onChange],
  )

  const handleStyleChange = useCallback(
    (style: string) => onChange({ ...settings, style }),
    [settings, onChange],
  )

  const handlePositionChange = useCallback(
    (position: string) => onChange({ ...settings, position: position as WatermarkPosition }),
    [settings, onChange],
  )

  const content = (
    <WatermarkSettingsContent
      stylePills={stylePills}
      settings={settings}
      onStyleChange={handleStyleChange}
      onPositionChange={handlePositionChange}
    />
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
              {content}
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
      {(!showToggle || settings.enabled) && content}
    </section>
  )
}

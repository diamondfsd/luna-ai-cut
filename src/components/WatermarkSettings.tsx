import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { resolveWatermarkRatios } from '../shared/watermark/layoutConfig'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { WatermarkPosition, WatermarkSettings as WatermarkSettingsType } from '../shared/types'

/** 5 个固定位置（对应原版 App） */
const POSITIONS: Array<{ value: string; label: string; row: number; col: number }> = [
  { value: 'top-left', label: '左上', row: 0, col: 0 },
  { value: 'top-right', label: '右上', row: 0, col: 2 },
  { value: 'bottom-left', label: '左下', row: 1, col: 0 },
  { value: 'bottom-center', label: '底中', row: 1, col: 1 },
  { value: 'bottom-right', label: '右下', row: 1, col: 2 },
]

const POSITION_GRID_ROWS = 2
const POSITION_GRID_COLS = 3
const FRAME_W = 160
const FRAME_H = 90

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
  const wmPreviewRects = useMemo(() => {
    const sensorW = Math.max(FRAME_W, FRAME_H)
    return POSITIONS.map((pos) => {
      const ratios = resolveWatermarkRatios(null, settings.style, FRAME_W, FRAME_H, pos.value)
      if (!ratios) return null
      const w = Math.round(sensorW * ratios.widthRatio)
      const h = Math.round(w * 0.3)
      const [vPos] = pos.value.split('-') as ['top' | 'bottom']
      const x = Math.round(ratios.xRatio * FRAME_W)
      const y = vPos === 'bottom'
        ? FRAME_H - h - Math.round(ratios.yRatio * FRAME_H)
        : Math.round((1 - ratios.yRatio) * FRAME_H)
      return { x, y, w, h }
    })
  }, [settings.style])

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
        {Array.from({ length: POSITION_GRID_ROWS * POSITION_GRID_COLS }, (_, i) => {
          const row = Math.floor(i / POSITION_GRID_COLS)
          const col = i % POSITION_GRID_COLS
          const posIdx = POSITIONS.findIndex((p) => p.row === row && p.col === col)
          if (posIdx < 0) return <div key={i} className="wm-pos-cell wm-pos-empty" />
          const pos = POSITIONS[posIdx]
          const active = settings.position === pos.value
          const rect = wmPreviewRects[posIdx]
          return (
            <button
              key={pos.value}
              className={`wm-pos-cell ${active ? 'active' : ''}`}
              onClick={() => onPositionChange(pos.value)}
              title={pos.label}
            >
              <svg viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} className="wm-pos-frame">
                {rect && (
                  <rect
                    x={Math.max(0, rect.x)}
                    y={Math.max(0, rect.y)}
                    width={Math.min(rect.w, FRAME_W - rect.x)}
                    height={Math.min(rect.h, FRAME_H - rect.y)}
                    fill="currentColor"
                    rx={2}
                    opacity={0.4}
                  />
                )}
              </svg>
            </button>
          )
        })}
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

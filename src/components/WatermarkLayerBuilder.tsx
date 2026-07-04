/**
 * WatermarkLayerBuilder — 水印设置组件
 *
 * 仅提供水印样式、位置、开关的设置 UI。
 * 水印位置计算已移除，由 Native Core 后端完成。
 */
import { useEffect, useMemo, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, SegmentedControl, Switch } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { resolveWatermarkRatios } from '../shared/watermark/layoutConfig'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { WatermarkPosition, WatermarkSettings } from '../shared/types'

interface Props {
  /** 文件路径（用于自动检测设备） */
  filePath?: string | null
  /** 源设备 ID */
  sourceDeviceId?: string | null
  compact?: boolean
}

const DEFAULT_SETTINGS: WatermarkSettings = {
  enabled: false,
  style: 'luna_ultra',
  position: 'bottom-center',
}

const POSITIONS: { value: string; label: string; row: number; col: number }[] = [
  { value: 'top-left', label: '左上', row: 0, col: 0 },
  { value: 'top-right', label: '右上', row: 0, col: 2 },
  { value: 'bottom-left', label: '左下', row: 1, col: 0 },
  { value: 'bottom-center', label: '底中', row: 1, col: 1 },
  { value: 'bottom-right', label: '右下', row: 1, col: 2 },
]

export function WatermarkLayerBuilder({ filePath, sourceDeviceId, compact }: Props) {
  const [settings, setSettings] = useState<WatermarkSettings>(DEFAULT_SETTINGS)

  // 自动检测设备 → 水印样式选项
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
    return opts.map((opt) => ({
      value: opt.value,
      label: WM_SRC[opt.value]?.image
        ? { image: WM_SRC[opt.value].image }
        : opt.label,
    }))
  }, [deviceId])

  // 打印映射表参数
  useEffect(() => {
    if (!settings.enabled) return
    const ratios = resolveWatermarkRatios(sourceDeviceId ?? null, settings.style, 1920, 1080, settings.position)
    console.log('[WatermarkLayerBuilder] 映射表参数:', {
      sourceDeviceId,
      style: settings.style,
      position: settings.position,
      ratios,
    })
  }, [settings.enabled, settings.style, settings.position, sourceDeviceId])

  // 样式选择
  const styleOptions = stylePills.map((opt) => {
    if (typeof opt.label === 'object' && 'image' in opt.label) {
      return { value: opt.value, label: <img src={opt.label.image} alt="" className="wm-style-thumb" /> }
    }
    return { value: opt.value, label: opt.label as string }
  })

  const content = (
    <div style={{ display: 'grid', gap: 10 }}>
      {styleOptions.length > 0 && (
        <SegmentedControl
          ariaLabel="水印样式"
          options={styleOptions}
          value={settings.style}
          onChange={(v) => setSettings((s) => ({ ...s, style: v }))}
          variant="size"
          className="size-switch wm-style-selector"
        />
      )}
      {/* 位置 grid */}
      <div className="wm-position-grid">
        {Array.from({ length: 2 * 3 }, (_, i) => {
          const row = Math.floor(i / 3), col = i % 3
          const pos = POSITIONS.find((p) => p.row === row && p.col === col)
          if (!pos) return <div key={i} className="wm-pos-cell wm-pos-empty" />
          return (
            <button key={pos.value} className={`wm-pos-cell ${settings.position === pos.value ? 'active' : ''}`}
              onClick={() => setSettings((s) => ({ ...s, position: pos.value as WatermarkPosition }))} title={pos.label}>
              <svg viewBox="0 0 160 90" className="wm-pos-frame">
                <rect x={pos.col * 53} y={pos.row * 45} width={54} height={45} fill="currentColor" rx={2} opacity={0.4} />
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )

  if (compact) {
    return (
      <div className="watermark-toolbar">
        <label className="watermark-toolbar-toggle">
          <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} ariaLabel="启用水印" />
          <ImagePlus size={14} />
          <span>水印</span>
        </label>
        {settings.enabled && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="watermark-settings-btn" title="水印参数设置"><Settings2 size={14} /></button>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ImagePlus size={14} />水印设置
        </span>
        <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} ariaLabel="启用水印" />
      </div>
      {settings.enabled && content}
    </section>
  )
}

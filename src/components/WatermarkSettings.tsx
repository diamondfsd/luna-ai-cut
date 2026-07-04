import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { luna_ultra_layout, STYLE_TO_THEME } from '../shared/watermark/layoutConfig'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { RenderStaticLayer, WatermarkPosition, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import '../styles/watermark-settings.css'

// ─── re-export ─────────────────────────────────────────
export type { RenderStaticLayer } from '../shared/types'

/**
 * 根据画布尺寸 + WatermarkSettings 构建 RenderStaticLayer
 * @param settings 水印设置（WatermarkSettings 类型）
 * @param cw 画布宽度
 * @param ch 画布高度
 * @param wmW 水印图片原始宽度
 * @param wmH 水印图片原始高度
 * @param imagePath 水印图片文件路径
 * @param widthRatio 映射表 widthRatio
 * @param xRatio 映射表 xRatio
 * @param yRatio 映射表 yRatio
 */
export function buildWatermarkStaticLayer(
  settings: WatermarkSettingsType,
  cw: number, ch: number,
  wmW: number, wmH: number,
  imagePath: string,
  widthRatio: number,
  xRatio: number,
  yRatio: number,
): RenderStaticLayer {
  const sensorW = Math.max(cw, ch)
  const dstW = widthRatio * sensorW / cw
  const dstH = dstW * (wmH / wmW) * (cw / ch)
  const dstX = xRatio
  const vPos = settings.position.startsWith('Bottom') ? 'bottom' : 'top'
  const dstY = vPos === 'bottom' ? 1 - dstH - yRatio : 1 - yRatio

  return {
    imagePath,
    dstX: Math.min(1, Math.max(0, dstX)),
    dstY: Math.min(1, Math.max(0, dstY)),
    dstW: Math.min(1, Math.max(0, dstW)),
    dstH: Math.min(1, Math.max(0, dstH)),
  }
}

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
  // 水印变更时输出映射表原始数据、文件路径和水印图片尺寸
  useEffect(() => {
    if (!settings.enabled) return
    const theme = STYLE_TO_THEME[settings.style]
    if (!theme) return
    const key = `${theme}|16:9|${settings.position}`
    const raw = luna_ultra_layout[key]
    let cancelled = false
    ;(async () => {
      const info = await window.luna.getWatermarkPath(settings.style, 'image').catch(() => undefined)
      if (cancelled || !info) return
      console.log('[WatermarkSettings] 映射表原始数据:', {
        key,
        widthRatio: raw?.[0],
        xRatio: raw?.[1],
        yRatio: raw?.[2],
        filePath: info.filePath,
        wmWidth: info.width,
        wmHeight: info.height,
        wmAspect: info.width / info.height,
      })
    })()
    return () => { cancelled = true }
  }, [settings.enabled, settings.style, settings.position])

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
            <svg viewBox="0 0 160 90" className="wm-pos-frame" />
          </button>
          <div className="wm-pos-cell wm-pos-placeholder" />
          <button key={POSITIONS[1].value}
            className={`wm-pos-cell ${settings.position === POSITIONS[1].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[1].value)} title={POSITIONS[1].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame" />
          </button>
        </div>
        <div className="wm-position-row">
          {POSITIONS.slice(2).map(pos => (
            <button key={pos.value}
              className={`wm-pos-cell ${settings.position === pos.value ? 'active' : ''}`}
              onClick={() => onPositionChange(pos.value)} title={pos.label}>
              <svg viewBox="0 0 160 90" className="wm-pos-frame" />
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { luna_ultra_layout, closestAspectRatio, POSITION_TO_KEY, STYLE_TO_THEME, resolveWatermarkRatios } from '../shared/watermark/layoutConfig'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import '../styles/watermark-settings.css'

/**
 * 根据 WatermarkSettings 构建 PreviewLayer
 * 需要 settings 中已填充 imagePath、wmAspect、widthRatio、xRatio、yRatio
 * @param settings 水印设置
 * @param layoutAspect 布局参考宽高比，如 "16:9"，与 luna_ultra_layout key 中的 aspect 一致
 */
export function buildWatermarkStaticLayer(settings: WatermarkSettingsType, layoutAspect?: string): PreviewLayer | null {
  if (!settings.enabled || !settings.imagePath || !settings.wmAspect) return null
  const { imagePath: filePath, wmAspect, widthRatio = 0, xRatio = 0, yRatio = 0 } = settings
  const vPos = positionKeyFor(settings.position).startsWith('Bottom') ? 'bottom' : 'top'
  const dstW = widthRatio
  // 从 layout key 中获取参考宽高比，与查表一致
  const parts = (layoutAspect ?? '16:9').split(':').map(Number)
  const refAspect = parts[0] && parts[1] ? parts[0] / parts[1] : 16 / 9
  const dstH = dstW * refAspect / wmAspect
  return {
    filePath,
    dstX: xRatio,
    dstY: vPos === 'bottom' ? 1 - dstH - yRatio : 1 - yRatio,
    dstW,
    dstH,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1, zIndex: 1,
    fit: 'contain',
  }
}

export function buildResolvedWatermarkStaticLayer(
  settings: WatermarkSettingsType,
  mediaWidth: number,
  mediaHeight: number,
): PreviewLayer | null {
  if (!settings.enabled || !settings.imagePath || !settings.wmAspect) return null
  const aspectKey = closestAspectRatio(mediaWidth, mediaHeight)
  const positionKey = settings.position.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  const ratios = resolveWatermarkRatios(null, settings.style, mediaWidth, mediaHeight, positionKey)
  const enriched = ratios
    ? { ...settings, widthRatio: ratios.widthRatio, xRatio: ratios.xRatio, yRatio: ratios.yRatio }
    : settings
  return buildWatermarkStaticLayer(enriched, aspectKey)
}

function positionKeyFor(position: string): string {
  return POSITION_TO_KEY[position] ?? position
}

const POSITIONS: Array<{ value: string; label: string; cx: number; cy: number }> = [
  { value: 'TopLeft', label: '左上', cx: 27, cy: 22.5 },
  { value: 'TopRight', label: '右上', cx: 133, cy: 22.5 },
  { value: 'BottomLeft', label: '左下', cx: 27, cy: 67.5 },
  { value: 'BottomCenter', label: '底中', cx: 80, cy: 67.5 },
  { value: 'BottomRight', label: '右下', cx: 133, cy: 67.5 },
]

export type WatermarkChangeHandler = (settings: WatermarkSettingsType, layer?: PreviewLayer) => void

interface WatermarkSettingsProps {
  settings?: WatermarkSettingsType
  onChange: WatermarkChangeHandler
  compact?: boolean
  showToggle?: boolean
  /** 传文件路径即可自动按设备过滤水印样式 */
  filePath?: string
  /** 媒体分辨率（用于按实际宽高比匹配水印布局） */
  mediaWidth?: number
  mediaHeight?: number
}

function WatermarkSettingsContent({ stylePills, settings, onStyleChange, onPositionChange }: {
  stylePills: Array<{ value: string; label: React.ReactNode }>
  settings: WatermarkSettingsType
  onStyleChange: (v: string) => void
  onPositionChange: (v: string) => void
}) {
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
              className={`wm-pos-cell ${positionKeyFor(settings.position) === POSITIONS[0].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[0].value)} title={POSITIONS[0].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame">
              <rect x={POSITIONS[0].cx - 10} y={POSITIONS[0].cy - 7} width={20} height={14} rx={3} />
            </svg>
          </button>
          <div className="wm-pos-cell wm-pos-placeholder" />
          <button key={POSITIONS[1].value}
              className={`wm-pos-cell ${positionKeyFor(settings.position) === POSITIONS[1].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[1].value)} title={POSITIONS[1].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame">
              <rect x={POSITIONS[1].cx - 10} y={POSITIONS[1].cy - 7} width={20} height={14} rx={3} />
            </svg>
          </button>
        </div>
        <div className="wm-position-row">
          {POSITIONS.slice(2).map(pos => (
            <button key={pos.value}
              className={`wm-pos-cell ${positionKeyFor(settings.position) === pos.value ? 'active' : ''}`}
              onClick={() => onPositionChange(pos.value)} title={pos.label}>
              <svg viewBox="0 0 160 90" className="wm-pos-frame">
                <rect x={pos.cx - 10} y={pos.cy - 7} width={20} height={14} rx={3} />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function WatermarkSettings({ settings, onChange, compact, showToggle = true, filePath, mediaWidth, mediaHeight }: WatermarkSettingsProps) {
  const [internalSettings, setInternalSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'BottomCenter' as WatermarkSettingsType['position'],
  })
  const currentSettings = settings ?? internalSettings

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

  // 媒体宽高比变化时重新计算水印层（如图片从横图切到竖图）
  const initRef = useRef(true)
  const enrichSeqRef = useRef(0)
  useEffect(() => {
    if (initRef.current) {
      initRef.current = false
    }
    enrichAndChange({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaWidth, mediaHeight])

  /** 获取水印路径和尺寸，与映射表比例合并后触发 onChange */
  const enrichAndChange = useCallback(async (patch: Partial<WatermarkSettingsType>) => {
    const seq = ++enrichSeqRef.current
    const next = { ...currentSettings, ...patch }
    if (!next.enabled) {
      if (seq === enrichSeqRef.current) {
        setInternalSettings(next)
        onChange(next)
      }
      return
    }
    const [info, theme] = await Promise.all([
      window.luna.getWatermarkPath(next.style, 'image').catch(() => null),
      Promise.resolve(STYLE_TO_THEME[next.style]),
    ])
    if (seq !== enrichSeqRef.current) return
    // 根据实际媒体宽高比查找布局（从 props 传入）
    const aspectKey = (mediaWidth && mediaHeight) ? closestAspectRatio(mediaWidth, mediaHeight) : '16:9'
    const layoutKey = theme ? `${theme}|${aspectKey}|${positionKeyFor(next.position)}` : null
    const raw = layoutKey ? luna_ultra_layout[layoutKey] : null
    const enriched: WatermarkSettingsType = {
      ...next,
      imagePath: info?.filePath,
      wmAspect: info ? info.width / info.height : undefined,
      widthRatio: raw?.[0],
      xRatio: raw?.[1],
      yRatio: raw?.[2],
    }
    const layer = enriched.imagePath && enriched.wmAspect
      ? buildWatermarkStaticLayer(enriched, aspectKey)
      : undefined
    setInternalSettings(enriched)
    onChange(enriched, layer ?? undefined)
  }, [currentSettings, onChange, filePath, mediaWidth, mediaHeight])

  const handleToggle = useCallback(
    (enabled: boolean) => enrichAndChange({ enabled }),
    [enrichAndChange],
  )

  const handleStyleChange = useCallback(
    (style: string) => enrichAndChange({ style }),
    [enrichAndChange],
  )

  const handlePositionChange = useCallback(
    (position: string) => enrichAndChange({ position: position as WatermarkSettingsType['position'] }),
    [enrichAndChange],
  )

  const content = (
    <WatermarkSettingsContent
      stylePills={stylePills}
      settings={currentSettings}
      onStyleChange={handleStyleChange}
      onPositionChange={handlePositionChange}
    />
  )

  if (compact) {
    return (
      <div className="watermark-toolbar">
        <label className="watermark-toolbar-toggle">
          <Switch checked={currentSettings.enabled} onCheckedChange={handleToggle} ariaLabel="启用水印" />
          <ImagePlus size={14} />
          <span>水印</span>
        </label>
        {currentSettings.enabled && (
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
          <Switch checked={currentSettings.enabled} onCheckedChange={handleToggle} ariaLabel="启用水印" />
        </div>
      )}
      {(!showToggle || currentSettings.enabled) && content}
    </section>
  )
}

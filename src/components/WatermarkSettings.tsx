import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, Switch, SegmentedControl } from '../ui'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { PreviewLayer, WatermarkPositioning, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import '../styles/watermark-settings.css'

/** 根据方向返回合适的定位参数（横屏 22%、竖屏 39%，参考旧 layout config） */
function positioningForOrient(isLandscape: boolean, anchor: WatermarkPositioning['anchor']): WatermarkPositioning {
  return {
    anchor,
    targetWidth: isLandscape ? 0.22 : 0.391,
    marginX: 0.033,
    marginY: isLandscape ? 0.059 : 0.033,
  }
}

/**
 * 构建水印 PreviewLayer
 */
export function buildWatermarkStaticLayer(settings: WatermarkSettingsType, isLandscape: boolean): PreviewLayer | null {
  if (!settings.enabled || !settings.imagePath || !settings.wmAspect) return null
  const { imagePath: filePath } = settings
  const positioning = positioningForOrient(isLandscape, settings.position)
  console.log('[WatermarkStaticLayer] build', { filePath, wmAspect: settings.wmAspect, isLandscape, positioning })
  return {
    filePath,
    dstX: 0, dstY: 0, dstW: 1, dstH: 1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1, zIndex: 1,
    positioning,
  }
}

export function buildResolvedWatermarkStaticLayer(
  settings: WatermarkSettingsType,
  width: number,
  height: number,
): PreviewLayer | null {
  if (!settings.enabled || !settings.imagePath || !settings.wmAspect) return null
  return buildWatermarkStaticLayer(settings, width >= height)
}

const POSITIONS: Array<{ value: string; label: string; cx: number; cy: number }> = [
  { value: 'top-left', label: '左上', cx: 27, cy: 22.5 },
  { value: 'top-right', label: '右上', cx: 133, cy: 22.5 },
  { value: 'bottom-left', label: '左下', cx: 27, cy: 67.5 },
  { value: 'bottom-center', label: '底中', cx: 80, cy: 67.5 },
  { value: 'bottom-right', label: '右下', cx: 133, cy: 67.5 },
]

export type WatermarkChangeHandler = (settings: WatermarkSettingsType, layer?: PreviewLayer) => void

interface WatermarkSettingsProps {
  settings?: WatermarkSettingsType
  onChange: WatermarkChangeHandler
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
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
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
              <rect x={POSITIONS[0].cx - 10} y={POSITIONS[0].cy - 7} width={20} height={14} rx={3} />
            </svg>
          </button>
          <div className="wm-pos-cell wm-pos-placeholder" />
          <button key={POSITIONS[1].value}
              className={`wm-pos-cell ${settings.position === POSITIONS[1].value ? 'active' : ''}`}
            onClick={() => onPositionChange(POSITIONS[1].value)} title={POSITIONS[1].label}>
            <svg viewBox="0 0 160 90" className="wm-pos-frame">
              <rect x={POSITIONS[1].cx - 10} y={POSITIONS[1].cy - 7} width={20} height={14} rx={3} />
            </svg>
          </button>
        </div>
        <div className="wm-position-row">
          {POSITIONS.slice(2).map(pos => (
            <button key={pos.value}
              className={`wm-pos-cell ${settings.position === pos.value ? 'active' : ''}`}
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

export function WatermarkSettings({ settings, onChange, compact, showToggle = true, filePath }: WatermarkSettingsProps) {
  const [internalSettings, setInternalSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'bottom-center',
  })
  const currentSettings = settings ?? internalSettings
  const [resolvedMediaSize, setResolvedMediaSize] = useState<{ w: number; h: number } | null>(null)
  const effectiveMediaWidth = resolvedMediaSize?.w
  const effectiveMediaHeight = resolvedMediaSize?.h
  const waitingForMediaSize = Boolean(filePath) && (!effectiveMediaWidth || !effectiveMediaHeight)

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

  useEffect(() => {
    if (!filePath) {
      setResolvedMediaSize(null)
      return
    }

    let cancelled = false
    setResolvedMediaSize(null)
    window.luna.workspace.getMediaResolution(filePath)
      .then((resolution) => {
        if (!cancelled) {
          console.log('[WatermarkSettings] media resolution', {
            filePath,
            width: resolution.width,
            height: resolution.height,
          })
          setResolvedMediaSize({ w: resolution.width, h: resolution.height })
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedMediaSize(null)
      })
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
    if (waitingForMediaSize) return
    if (initRef.current) {
      initRef.current = false
    }
    enrichAndChange({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMediaWidth, effectiveMediaHeight, waitingForMediaSize])

  /** 获取水印路径和尺寸，与映射表比例合并后触发 onChange */
  const enrichAndChange = useCallback(async (patch: Partial<WatermarkSettingsType>) => {
    const seq = ++enrichSeqRef.current
    const next = { ...currentSettings, ...patch }
    if (filePath && (!effectiveMediaWidth || !effectiveMediaHeight)) {
      setInternalSettings(next)
      onChange(next)
      return
    }
    if (!next.enabled) {
      if (seq === enrichSeqRef.current) {
        setInternalSettings(next)
        onChange(next)
      }
      return
    }
    const info = await window.luna.getWatermarkPath(next.style, 'image').catch(() => null)
    if (seq !== enrichSeqRef.current) return
    const isLandscape = (effectiveMediaWidth ?? 16) >= (effectiveMediaHeight ?? 9)
    const enriched: WatermarkSettingsType = {
      ...next,
      imagePath: info?.filePath,
      wmAspect: info ? info.width / info.height : undefined,
    }
    const layer = enriched.imagePath && enriched.wmAspect
      ? buildWatermarkStaticLayer(enriched, isLandscape)
      : undefined
    console.log('[WatermarkSettings] computed layer', {
      filePath,
      mediaSize: effectiveMediaWidth && effectiveMediaHeight ? `${effectiveMediaWidth}x${effectiveMediaHeight}` : null,
      style: next.style,
      position: next.position,
      isLandscape,
      watermarkSize: info ? `${info.width}x${info.height}` : null,
      wmAspect: enriched.wmAspect,
      layer,
    })
    setInternalSettings(enriched)
    onChange(enriched, layer ?? undefined)
  }, [currentSettings, onChange, filePath, effectiveMediaWidth, effectiveMediaHeight])

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
    <div>
      {showToggle && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            水印设置
          </span>
          <Switch checked={currentSettings.enabled} onCheckedChange={handleToggle} ariaLabel="启用水印" />
        </div>
      )}
      {(!showToggle || currentSettings.enabled) && content}
    </div>
  )
}

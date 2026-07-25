import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, ImagePlus, RotateCcw, Settings2 } from 'lucide-react'
import { Slider as RadixSlider } from 'radix-ui'

import { filePathToPreviewUrl, isVideoPath } from '../lib/fileUtils'
import { resolveDeviceId } from '../shared/insta360DeviceProfiles'
import type { CustomWatermarkAsset, PreviewLayer, WatermarkPosition, WatermarkPositioning, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import {
  DEFAULT_WATERMARK_WIDTH_RATIO,
  defaultWatermarkPlacement,
  effectiveWatermarkPlacement,
  resolveWatermarkPositioning,
  usesCustomWatermark,
  watermarkImagePath,
} from '../shared/watermarkGeometry'
import { getCachedWatermarkPath, watermarkStyleOptionsForDevice, WM_SRC } from '../shared/watermarkAssets'
import { addCustomWatermarkAssets, matchesWatermarkFileName } from '../shared/watermarkLibrary'
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, SearchField, SegmentedControl, Switch, toast } from '../ui'
import '../styles/watermark-settings.css'

function legacyPositioning(isLandscape: boolean, anchor: WatermarkPositioning['anchor']): WatermarkPositioning {
  return {
    anchor,
    targetWidth: isLandscape ? 0.22 : 0.391,
    marginX: 0.033,
    marginY: isLandscape ? 0.059 : 0.033,
  }
}

function usesAdvancedGeometry(settings: WatermarkSettingsType): boolean {
  return usesCustomWatermark(settings)
}

function builtinWatermarkPosition(position: WatermarkPosition): Exclude<WatermarkPosition, 'top-center'> {
  return position === 'top-center' ? 'bottom-center' : position
}

export function buildWatermarkStaticLayer(
  settings: WatermarkSettingsType,
  isLandscape: boolean,
  mediaSize?: { width: number; height: number },
): PreviewLayer | null {
  if (!settings.enabled) return null
  const filePath = watermarkImagePath(settings) || getCachedWatermarkPath(settings.style)
  if (!filePath) return null
  const width = mediaSize?.width ?? (isLandscape ? 16 : 9)
  const height = mediaSize?.height ?? (isLandscape ? 9 : 16)
  const positioning = usesAdvancedGeometry(settings)
    ? resolveWatermarkPositioning(settings, width, height)
    : legacyPositioning(isLandscape, builtinWatermarkPosition(settings.position))
  return {
    filePath,
    dstX: 0, dstY: 0, dstW: 1, dstH: 1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: usesCustomWatermark(settings) ? Math.min(1, Math.max(0, settings.opacity ?? 1)) : 1,
    zIndex: 1,
    positioning,
  }
}

export function buildResolvedWatermarkStaticLayer(
  settings: WatermarkSettingsType,
  width: number,
  height: number,
): PreviewLayer | null {
  return buildWatermarkStaticLayer(settings, width >= height, { width, height })
}

const CUSTOM_POSITIONS: Array<{ value: WatermarkPosition; label: string }> = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '顶部居中' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '底部居中' },
  { value: 'bottom-right', label: '右下' },
]

const BUILTIN_POSITIONS: Array<(typeof CUSTOM_POSITIONS)[number] | null> = [
  CUSTOM_POSITIONS[0],
  null,
  CUSTOM_POSITIONS[2],
  ...CUSTOM_POSITIONS.slice(3),
]

export type WatermarkChangeHandler = (settings: WatermarkSettingsType, layer?: PreviewLayer) => void

interface WatermarkSettingsProps {
  settings?: WatermarkSettingsType
  onChange: WatermarkChangeHandler
  compact?: boolean
  showToggle?: boolean
  preferencesOnly?: boolean
  title?: string
  filePath?: string
  mediaKind?: 'image' | 'video'
  allowBuiltin?: boolean
}

function WatermarkSlider({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="wm-slider-field">
      <div className="wm-slider-label"><span>{label}</span><span>{Math.round(value)}%</span></div>
      <RadixSlider.Root
        className="wm-slider-root"
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next)}
      >
        <RadixSlider.Track className="wm-slider-track"><RadixSlider.Range className="wm-slider-range" /></RadixSlider.Track>
        <RadixSlider.Thumb className="wm-slider-thumb" aria-label={label} />
      </RadixSlider.Root>
    </div>
  )
}

function PositionGrid({ settings, custom, onChange }: {
  settings: WatermarkSettingsType
  custom: boolean
  onChange: (position: WatermarkPosition) => void
}) {
  const placement = custom ? effectiveWatermarkPlacement(settings) : null
  const activePosition = placement?.mode === 'preset' ? placement.anchor : custom ? null : builtinWatermarkPosition(settings.position)
  const positions = custom ? CUSTOM_POSITIONS : BUILTIN_POSITIONS
  return (
    <div className="wm-position-grid" role="group" aria-label="水印位置">
      {positions.map((position, index) => position ? (
        <button
          key={position.value}
          type="button"
          className={`wm-pos-cell${activePosition === position.value ? ' active' : ''}`}
          data-position={position.value}
          onClick={() => onChange(position.value)}
          title={position.label}
          aria-label={position.label}
        >
          <span className="wm-pos-dot" />
        </button>
      ) : <span key={`placeholder-${index}`} className="wm-pos-placeholder" aria-hidden="true" />)}
    </div>
  )
}

export function WatermarkSettings({
  settings,
  onChange,
  compact,
  showToggle = true,
  preferencesOnly = false,
  title = '水印设置',
  filePath,
  mediaKind,
  allowBuiltin = true,
}: WatermarkSettingsProps) {
  const controlled = settings !== undefined
  const [internalSettings, setInternalSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'bottom-center',
  })
  const [hydrated, setHydrated] = useState(controlled)
  const currentSettings = settings ?? internalSettings
  const settingsRef = useRef(currentSettings)
  const onChangeRef = useRef(onChange)
  settingsRef.current = currentSettings
  onChangeRef.current = onChange
  const [resolvedMediaSize, setResolvedMediaSize] = useState<{ width: number; height: number } | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [customAssets, setCustomAssets] = useState<CustomWatermarkAsset[]>([])
  const [customSearch, setCustomSearch] = useState('')
  const enrichSeqRef = useRef(0)
  const watermarkKind = mediaKind ?? (filePath && isVideoPath(filePath) ? 'video' : 'image')

  useEffect(() => {
    let cancelled = false
    window.luna.getSettings().then((appSettings) => {
      if (cancelled) return
      setCustomAssets(appSettings.customWatermarkAssets ?? [])
      if (!controlled && appSettings.recentWatermarkSettings) {
        setInternalSettings(appSettings.recentWatermarkSettings)
      }
    }).finally(() => { if (!cancelled) setHydrated(true) })
    return () => { cancelled = true }
  }, [controlled])

  useEffect(() => {
    if (preferencesOnly || !filePath) return
    let cancelled = false
    resolveDeviceId(
      { sourceDeviceId: null, cameraType: null, sourceDeviceName: null, cameraSerial: null, watermarkProfileId: null },
      { filePath, readExif: window.luna.readExifModel.bind(window.luna) },
    ).then((id) => { if (!cancelled) setDeviceId(id) })
      .catch(() => { if (!cancelled) setDeviceId(null) })
    return () => { cancelled = true }
  }, [filePath, preferencesOnly])

  useEffect(() => {
    if (!filePath) {
      setResolvedMediaSize(null)
      return
    }
    let cancelled = false
    setResolvedMediaSize(null)
    window.luna.workspace.getMediaResolution(filePath)
      .then((resolution) => { if (!cancelled) setResolvedMediaSize(resolution) })
      .catch(() => { if (!cancelled) setResolvedMediaSize(null) })
    return () => { cancelled = true }
  }, [filePath])

  const stylePills = useMemo(() => {
    if (preferencesOnly) return []
    return watermarkStyleOptionsForDevice(deviceId).map((option) => {
      const thumbSrc = WM_SRC[option.value]?.[watermarkKind]
      return {
        value: option.value,
        label: thumbSrc ? <img src={thumbSrc} alt={option.label} className="wm-style-thumb" /> : option.label,
      }
    })
  }, [deviceId, preferencesOnly, watermarkKind])

  const publish = useCallback((next: WatermarkSettingsType, layer?: PreviewLayer) => {
    settingsRef.current = next
    if (!controlled) {
      setInternalSettings(next)
      void window.luna.saveSettings({ recentWatermarkSettings: next }).catch(() => {})
    }
    onChangeRef.current(next, layer)
  }, [controlled])

  const enrichAndChange = useCallback(async (patch: Partial<WatermarkSettingsType>) => {
    const seq = ++enrichSeqRef.current
    let next = { ...settingsRef.current, ...patch }
    if (preferencesOnly) {
      publish(next)
      return
    }
    if (next.sourceKind === 'custom') {
      next = next.customAsset
        ? {
            ...next,
            imagePath: next.customAsset.filePath,
            imageWidth: next.customAsset.width,
            imageHeight: next.customAsset.height,
          }
        : {
            ...next,
            imagePath: undefined,
            imageWidth: undefined,
            imageHeight: undefined,
          }
    } else if (next.enabled && allowBuiltin) {
      const info = await window.luna.getWatermarkPath(next.style, watermarkKind).catch(() => null)
      if (seq !== enrichSeqRef.current) return
      next = { ...next, sourceKind: 'builtin', imagePath: info?.filePath, imageWidth: info?.width, imageHeight: info?.height }
    } else if (!allowBuiltin) {
      next = { ...next, imagePath: undefined, imageWidth: undefined, imageHeight: undefined }
    }
    const size = resolvedMediaSize ?? { width: 16, height: 9 }
    const layer = next.enabled ? buildResolvedWatermarkStaticLayer(next, size.width, size.height) ?? undefined : undefined
    publish(next, layer)
  }, [allowBuiltin, preferencesOnly, publish, resolvedMediaSize, watermarkKind])

  useEffect(() => {
    if (!hydrated || (filePath && !resolvedMediaSize)) return
    void enrichAndChange({})
  }, [enrichAndChange, filePath, hydrated, resolvedMediaSize])

  async function chooseCustomAsset(): Promise<void> {
    if (importing) return
    setImporting(true)
    try {
      const assets = await window.luna.chooseCustomWatermarks()
      if (assets.length === 0) return
      const asset = assets[0]
      setCustomAssets((current) => addCustomWatermarkAssets(current, assets))
      await enrichAndChange({
        sourceKind: 'custom',
        customAsset: asset,
        imagePath: asset.filePath,
        imageWidth: asset.width,
        imageHeight: asset.height,
        sizeOnCanvasWidth: settingsRef.current.sizeOnCanvasWidth ?? DEFAULT_WATERMARK_WIDTH_RATIO,
        placement: settingsRef.current.placement ?? defaultWatermarkPlacement(settingsRef.current.position),
        opacity: settingsRef.current.opacity ?? 1,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法导入这张水印图片')
    } finally {
      setImporting(false)
    }
  }

  function changeSource(sourceKind: 'builtin' | 'custom'): void {
    if (sourceKind === 'custom' && !currentSettings.customAsset && customAssets.length > 0) {
      selectCustomAsset(customAssets[0])
      return
    }
    void enrichAndChange({
      sourceKind,
      position: sourceKind === 'builtin' ? builtinWatermarkPosition(currentSettings.position) : currentSettings.position,
    })
  }

  function selectCustomAsset(asset: CustomWatermarkAsset): void {
    void enrichAndChange({
      sourceKind: 'custom',
      customAsset: asset,
      imagePath: asset.filePath,
      imageWidth: asset.width,
      imageHeight: asset.height,
      sizeOnCanvasWidth: settingsRef.current.sizeOnCanvasWidth ?? DEFAULT_WATERMARK_WIDTH_RATIO,
      placement: settingsRef.current.placement ?? defaultWatermarkPlacement(settingsRef.current.position),
      opacity: settingsRef.current.opacity ?? 1,
    })
  }

  function changePosition(position: WatermarkPosition): void {
    const patch: Partial<WatermarkSettingsType> = { position }
    if (usesCustomWatermark(settingsRef.current)) {
      patch.placement = defaultWatermarkPlacement(position)
    }
    void enrichAndChange(patch)
  }

  function resetGeometry(): void {
    if (usesCustomWatermark(settingsRef.current)) {
      void enrichAndChange({
        position: 'bottom-center',
        placement: defaultWatermarkPlacement('bottom-center'),
        sizeOnCanvasWidth: DEFAULT_WATERMARK_WIDTH_RATIO,
        opacity: 1,
      })
      return
    }
    void enrichAndChange({ position: 'bottom-center', placement: undefined, sizeOnCanvasWidth: undefined, opacity: undefined })
  }

  const selectedSourceKind = allowBuiltin ? currentSettings.sourceKind ?? 'builtin' : 'custom'
  const customSelected = selectedSourceKind === 'custom' && usesCustomWatermark(currentSettings)
  const sourceOptions: Array<{ value: 'builtin' | 'custom'; label: string }> = allowBuiltin
    ? [{ value: 'builtin', label: '内置' }, { value: 'custom', label: '自定义' }]
    : [{ value: 'custom', label: '自定义' }]
  const filteredCustomAssets = useMemo(() => {
    const selectableCustomAssets = currentSettings.customAsset && !customAssets.some((asset) => asset.id === currentSettings.customAsset?.id)
      ? [currentSettings.customAsset, ...customAssets]
      : customAssets
    return selectableCustomAssets.filter((asset) => matchesWatermarkFileName(asset.fileName, customSearch))
  }, [currentSettings.customAsset, customAssets, customSearch])

  const content = (
    <div className="wm-settings-content">
      {!preferencesOnly && (
        <div className={`wm-source-row${selectedSourceKind === 'custom' ? ' has-search' : ''}`}>
          <SegmentedControl
            ariaLabel="水印来源"
            options={sourceOptions}
            value={selectedSourceKind}
            onChange={changeSource}
            variant="size"
            className="size-switch wm-source-selector"
          />
          {selectedSourceKind === 'custom' && (
            <SearchField
              variant="compact"
              fullWidth
              wrapperClassName="wm-custom-search"
              value={customSearch}
              onChange={(event) => setCustomSearch(event.currentTarget.value)}
              placeholder="搜索"
              aria-label="按文件名搜索水印"
            />
          )}
        </div>
      )}

      {!preferencesOnly && selectedSourceKind === 'custom' && (
        <div className="wm-custom-library">
          {filteredCustomAssets.length > 0 && (
            <div className="wm-custom-options" role="listbox" aria-label="自定义水印">
              {filteredCustomAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  role="option"
                  aria-selected={currentSettings.customAsset?.id === asset.id}
                  className={`wm-custom-option${currentSettings.customAsset?.id === asset.id ? ' active' : ''}`}
                  onClick={() => selectCustomAsset(asset)}
                  title={asset.fileName}
                >
                  <img src={filePathToPreviewUrl(asset.filePath) ?? ''} alt="" />
                </button>
              ))}
            </div>
          )}
          <Button variant="secondary" size="compact" icon={<FolderOpen size={15} />} onClick={() => void chooseCustomAsset()} disabled={importing}>
            {importing ? '正在导入' : '添加水印'}
          </Button>
        </div>
      )}

      {!preferencesOnly && selectedSourceKind === 'builtin' && stylePills.length > 0 && (
        <SegmentedControl ariaLabel="水印样式" options={stylePills} value={currentSettings.style} onChange={(style) => void enrichAndChange({ style })} variant="size" className="size-switch wm-style-selector" />
      )}

      {(selectedSourceKind === 'builtin' || customSelected) && (
        <PositionGrid settings={currentSettings} custom={customSelected} onChange={changePosition} />
      )}

      {!preferencesOnly && customSelected && (
        <>
          <WatermarkSlider label="大小" value={(currentSettings.sizeOnCanvasWidth ?? DEFAULT_WATERMARK_WIDTH_RATIO) * 100} min={8} max={80} onChange={(value) => void enrichAndChange({ sizeOnCanvasWidth: value / 100 })} />
          <WatermarkSlider label="透明度" value={(currentSettings.opacity ?? 1) * 100} min={0} max={100} onChange={(value) => void enrichAndChange({ opacity: value / 100 })} />
          <Button variant="ghost" size="mini" icon={<RotateCcw size={14} />} onClick={resetGeometry}>重置位置与大小</Button>
        </>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="watermark-toolbar">
        <label className="watermark-toolbar-toggle">
          <Switch checked={currentSettings.enabled} onCheckedChange={(enabled) => void enrichAndChange({ enabled })} ariaLabel="启用水印" />
          <ImagePlus size={14} />
          <span>水印</span>
        </label>
        {currentSettings.enabled && (
          <Popover>
            <PopoverTrigger asChild><IconButton variant="ghost" size="mini" icon={<Settings2 size={14} />} title="水印参数设置" /></PopoverTrigger>
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
        <div className="wm-settings-header">
          <span className="eyebrow">{title}</span>
          <Switch checked={currentSettings.enabled} onCheckedChange={(enabled) => void enrichAndChange({ enabled })} ariaLabel="启用水印" />
        </div>
      )}
      {(!showToggle || currentSettings.enabled || preferencesOnly) && content}
    </div>
  )
}

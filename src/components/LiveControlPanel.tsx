import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Download, Minimize2, Video } from 'lucide-react'

import { Accordion, Button, Select, Switch, toast } from '../ui'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { isTechnicalLut } from '../workspace/lut/restoreLuts'
import { lutManager } from '../workspace/lut/LutManager'
import type { LutFileInfo } from '../workspace/lut/builtinLuts'
import { DEFAULT_PIPELINE, type EditPipeline } from '../workspace/shared/editPipeline'
import { ParamSlider } from '../workspace/components/ParamSlider'
import { TonePanel } from '../workspace/color/TonePanel'
import { WhiteBalancePanel } from '../workspace/color/WhiteBalancePanel'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import { resolveWatermarkPositioning as resolvePreviewWatermarkPositioning, watermarkPositionStyle } from './htmlPreviewGeometry'
import { buildResolvedWatermarkStaticLayer, WatermarkSettings } from './WatermarkSettings'
import type { LiveVideoColorAdjustments } from './LiveVideoWebGpuRenderer'
import type { LiveStreamStatus } from '../shared/types'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

interface LiveControlPanelProps {
  status: LiveStreamStatus
  busy: boolean
  onStart: () => void
  windowLiveMode: boolean
  onExitWindowLiveMode: () => void
  onPreviewClick?: (event: MouseEvent<HTMLDivElement>) => void
}

function previewStatusLabel(status: LiveStreamStatus, previewReady: boolean): string {
  if (status.usbState === 'streaming') return previewReady ? '画面已连接' : '正在打开画面'
  if (status.state === 'starting') return '正在连接'
  return status.usbMessage || '等待手机连接'
}

export function LiveControlPanel({
  status,
  busy,
  onStart,
  windowLiveMode,
  onExitWindowLiveMode,
  onPreviewClick,
}: LiveControlPanelProps) {
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewReady, setPreviewReady] = useState(false)
  const [webGpuReady, setWebGpuReady] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewDimensions, setPreviewDimensions] = useState({ width: 16, height: 9 })
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>({
    enabled: false,
    style: 'luna_ultra_cn',
    position: 'bottom-right',
    sourceKind: 'builtin',
  })
  const [luts, setLuts] = useState<LutFileInfo[]>([])
  const [lutPath, setLutPath] = useState('none')
  const [lutIntensity, setLutIntensity] = useState(100)
  const [liveColor, setLiveColor] = useState<EditPipeline['color']>(() => structuredClone(DEFAULT_PIPELINE.color))
  const windowLiveModeRef = useRef(windowLiveMode)
  const lastWindowAspectRef = useRef<number | null>(null)
  windowLiveModeRef.current = windowLiveMode

  const active = Boolean(status.startedAt) && status.state !== 'stopping'
  const streaming = status.usbState === 'streaming'

  useEffect(() => {
    const pane = previewPaneRef.current
    if (!pane) return undefined
    const update = () => {
      const rect = pane.getBoundingClientRect()
      let width = rect.width
      let height = width / previewAspectRatio
      if (height > rect.height) {
        height = rect.height
        width = height * previewAspectRatio
      }
      setPreviewStageSize({ width: Math.max(0, width), height: Math.max(0, height) })
    }
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    update()
    return () => observer.disconnect()
  }, [previewAspectRatio])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await window.luna.getSettings()
        const lutDir = settings?.lutDir || (settings?.baseDir ? `${settings.baseDir}/luts` : '')
        const discovered = await lutManager.discoverLuts(lutDir)
        if (!cancelled) setLuts(discovered.filter((lut) => !isTechnicalLut(lut)))
      } catch (error) {
        window.luna.log('warn', '直播 LUT 列表加载失败', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handlePreviewFrame = useCallback((dimensions: { width: number; height: number }) => {
    const aspectRatio = dimensions.width / dimensions.height
    setPreviewAspectRatio(aspectRatio)
    setPreviewDimensions((current) => (
      current.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ))
    setPreviewReady(true)
    setPreviewError(null)
    if (!windowLiveModeRef.current) {
      lastWindowAspectRef.current = null
      return
    }
    if (lastWindowAspectRef.current == null || Math.abs(lastWindowAspectRef.current - aspectRatio) > 0.002) {
      lastWindowAspectRef.current = aspectRatio
      void window.luna.setLiveWindowMode(true, '720p', aspectRatio).catch((error: unknown) => {
        window.luna.log('warn', '窗口直播画面尺寸调整失败', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }, [])

  const handlePreviewError = useCallback((message: string) => {
    setPreviewReady(false)
    setPreviewError(message)
  }, [])

  const handleWebGpuReadyChange = useCallback((ready: boolean) => {
    setWebGpuReady(ready)
  }, [])

  const handleEffectError = useCallback((message: string) => {
    window.luna.log('warn', '直播 LUT 应用失败', { error: message })
    toast.error('LUT 应用失败')
  }, [])

  const handleColorChange = useCallback((patch: Partial<EditPipeline['color']>) => {
    setLiveColor((current) => ({ ...current, ...patch }))
  }, [])

  const watermarkLayer = watermarkSettings.enabled
    ? buildResolvedWatermarkStaticLayer(watermarkSettings, previewDimensions.width, previewDimensions.height)
    : null
  const watermarkPositioning = watermarkLayer
    ? resolvePreviewWatermarkPositioning(watermarkLayer, previewDimensions)
    : null
  const watermarkSrc = filePathToPreviewUrl(watermarkLayer?.filePath)
  const activeLut = lutPath !== 'none'
  const lutOptions = [
    { value: 'none', label: '关闭' },
    ...luts.map((lut) => ({ value: lut.filePath, label: lut.name })),
  ]
  const liveColorAdjustments = useMemo<LiveVideoColorAdjustments>(() => ({
    exposure: liveColor.exposure,
    black: 0,
    brightness: liveColor.brightness,
    contrast: liveColor.contrast,
    saturation: liveColor.saturation,
    vibrance: liveColor.vibrance,
    temperature: liveColor.temperature,
    tint: liveColor.tint,
    highlights: liveColor.highlights,
    shadows: liveColor.shadows,
    whites: liveColor.whites,
    blacks: liveColor.blacks,
  }), [liveColor])
  const whiteBalanceModified = liveColor.temperature !== 0 || liveColor.tint !== 0 || liveColor.whiteBalanceMode !== 'custom'
  const toneModified = liveColor.exposure !== 0 || liveColor.brightness !== 0 || liveColor.contrast !== 0
    || liveColor.highlights !== 0 || liveColor.shadows !== 0 || liveColor.whites !== 0 || liveColor.blacks !== 0
    || liveColor.vibrance !== 0 || liveColor.saturation !== 0

  return (
    <section className="live-control-panel" aria-label="直播预览">
      <div ref={previewPaneRef} className="live-preview-pane" onClick={onPreviewClick}>
        <div
          className="live-preview-stage"
          style={{ width: previewStageSize.width, height: previewStageSize.height }}
        >
          {status.localPreviewUrl && (
            <AnnexBVideoCanvas
              url={status.localPreviewUrl}
              lutPath={activeLut ? lutPath : null}
              lutIntensity={lutIntensity}
              colorAdjustments={liveColorAdjustments}
              className="live-preview-canvas"
              onFrame={handlePreviewFrame}
              onError={handlePreviewError}
              onWebGpuReadyChange={handleWebGpuReadyChange}
              onEffectError={handleEffectError}
            />
          )}

          {watermarkPositioning && watermarkSrc && (
            <img
              className="live-preview-watermark"
              src={watermarkSrc}
              alt=""
              draggable={false}
              style={{ ...watermarkPositionStyle(watermarkPositioning), opacity: watermarkLayer?.opacity ?? 1 }}
            />
          )}

          {!active && (
            <div className="live-preview-overlay live-preview-onboarding">
              <ol>
                <li>
                  <span>1</span>
                  <p>打开 Luna 咔，连接相机</p>
                  {!status.receiverConnected && (
                    <Button
                      variant="secondary"
                      size="mini"
                      icon={<Download size={14} />}
                      onClick={() => void window.luna.openPath(MOBILE_APP_DOWNLOAD_URL)}
                    >
                      下载 App
                    </Button>
                  )}
                </li>
                <li><span>2</span><p>用 USB 连接手机和电脑</p></li>
              </ol>
              <div className="live-preview-actions">
                <Button
                  variant="primary"
                  icon={<Video size={15} />}
                  onClick={onStart}
                  disabled={busy}
                >
                  {busy ? '处理中...' : '获取画面'}
                </Button>
              </div>
            </div>
          )}

          {active && !streaming && (
            <div className="live-preview-overlay">
              <strong>{status.state === 'starting' ? '正在启动' : '等待手机连接'}</strong>
              {status.state !== 'starting' && <span>用 USB 连接手机和电脑</span>}
            </div>
          )}

          {streaming && (previewError || !previewReady) && (
            <div className="live-preview-overlay">
              <strong>{previewError ?? status.localPreviewError ?? (status.localPreviewUrl ? '正在打开直播画面' : '正在准备软件预览')}</strong>
            </div>
          )}
        </div>
      </div>

      <aside className="live-control-pane" data-live-window-controls aria-label="直播设置">
        <div className="live-settings-scroll">
          <h2 className="live-settings-title">直播设置</h2>
          <Accordion
            title="水印"
            defaultOpen
            actions={(
              <Switch
                checked={watermarkSettings.enabled}
                onCheckedChange={(enabled) => setWatermarkSettings((current) => ({ ...current, enabled }))}
                ariaLabel="启用水印"
              />
            )}
          >
            <WatermarkSettings
              settings={watermarkSettings}
              onChange={(settings) => setWatermarkSettings({ ...settings, sourceKind: 'builtin', style: 'luna_ultra_cn' })}
              mediaKind="video"
              showToggle={false}
              showSourceSelector={false}
              showStyleSelector={false}
              deviceMetadata={{ sourceDeviceId: 'luna-ultra', watermarkProfileId: 'luna-ultra' }}
            />
          </Accordion>

          <Accordion title="LUT" defaultOpen modified={activeLut}>
            <Select
              variant="compact"
              fullWidth
              value={lutPath}
              onValueChange={setLutPath}
              options={lutOptions}
              placeholder="LUT"
              disabled={!webGpuReady || luts.length === 0}
              contentClassName="live-settings-select-content"
            />
            {activeLut && (
              <ParamSlider
                  label="强度"
                  value={lutIntensity}
                  min={0}
                  max={100}
                  step={1}
                  onChange={setLutIntensity}
                  formatValue={(value) => `${value}%`}
              />
            )}
          </Accordion>

          <WhiteBalancePanel
            value={liveColor}
            modified={whiteBalanceModified}
            onChange={handleColorChange}
            onPreviewChange={handleColorChange}
            showPipette={false}
          />
          <TonePanel
            value={liveColor}
            modified={toneModified}
            onChange={handleColorChange}
            onPreviewChange={handleColorChange}
            includeDetailControls={false}
          />
        </div>

        {windowLiveMode && (
          <div className="live-control-pane-footer">
            <span className="live-window-preview-status">{previewStatusLabel(status, previewReady)}</span>
            <Button
              variant="secondary"
              size="compact"
              icon={<Minimize2 size={14} />}
              onClick={onExitWindowLiveMode}
              disabled={busy}
            >
              退出窗口直播
            </Button>
          </div>
        )}
      </aside>
    </section>
  )
}

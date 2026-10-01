import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Video } from 'lucide-react'

import { Accordion, Button, SegmentedControl, Switch } from '../ui'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { DEFAULT_PIPELINE, type EditPipeline } from '../workspace/shared/editPipeline'
import { DetailPanel } from '../workspace/color/DetailPanel'
import { TonePanel } from '../workspace/color/TonePanel'
import { WhiteBalancePanel } from '../workspace/color/WhiteBalancePanel'
import { FilterPanel } from '../workspace/lut/FilterPanel'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import { LiveCameraControlPanel } from './LiveCameraControlPanel'
import { resolveWatermarkPositioning as resolvePreviewWatermarkPositioning, watermarkPositionStyle } from './htmlPreviewGeometry'
import { buildResolvedWatermarkStaticLayer, WatermarkSettings } from './WatermarkSettings'
import type { LiveVideoColorAdjustments } from './LiveVideoWebGpuRenderer'
import type { LivePreviewWindowSettings, LiveStreamStatus, NormalizedVideoPoint } from '../shared/types'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

type LiveSettingsPanel = 'color' | 'lut' | 'watermark' | 'control'

function previewPoint(event: ReactPointerEvent<HTMLDivElement>, rect: DOMRect): NormalizedVideoPoint {
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

interface LiveControlPanelProps {
  status: LiveStreamStatus
  busy: boolean
  onStart: () => void
}

export function LiveControlPanel({
  status,
  busy,
  onStart,
}: LiveControlPanelProps) {
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewDimensions, setPreviewDimensions] = useState({ width: 16, height: 9 })
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<LiveSettingsPanel>('control')
  const [focusPoint, setFocusPoint] = useState<NormalizedVideoPoint | null>(null)
  const gestureRef = useRef<{ pointerId: number; start: NormalizedVideoPoint } | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const [lutPath, setLutPath] = useState<string | null>(null)
  const [lutIntensity, setLutIntensity] = useState(30)
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'bottom-center',
    sourceKind: 'builtin',
  })
  const [liveColor, setLiveColor] = useState<EditPipeline['color']>(() => structuredClone(DEFAULT_PIPELINE.color))
  const active = Boolean(status.startedAt) && status.state !== 'stopping'
  const streaming = status.usbState === 'streaming'
  const controlReady = status.controlReady && status.receiverConnected

  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
  }, [])

  const focusAt = useCallback((point: NormalizedVideoPoint) => {
    setFocusPoint(point)
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    focusTimerRef.current = window.setTimeout(() => setFocusPoint(null), 900)
    if (!controlReady || status.capabilities?.focus.tap === false) return
    void window.luna.liveStream.sendControl({ type: 'focus.tap', point }).catch((reason: unknown) => {
      window.luna.log('warn', '直播控制指令发送失败', {
        type: 'focus.tap',
        error: reason instanceof Error ? reason.message : String(reason),
      })
    })
  }, [controlReady, status.capabilities])

  const startPreviewGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeSettingsPanel !== 'control' || event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    gestureRef.current = { pointerId: event.pointerId, start: previewPoint(event, rect) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const endPreviewGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const end = previewPoint(event, rect)
    if (Math.hypot((end.x - gesture.start.x) * rect.width, (end.y - gesture.start.y) * rect.height) < 8) {
      focusAt(end)
    }
  }

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

  const handlePreviewFrame = useCallback((dimensions: { width: number; height: number }) => {
    const aspectRatio = dimensions.width / dimensions.height
    setPreviewAspectRatio(aspectRatio)
    setPreviewDimensions((current) => (
      current.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ))
    setPreviewReady(true)
    setPreviewError(null)
  }, [])

  const handlePreviewError = useCallback((message: string) => {
    setPreviewReady(false)
    setPreviewError(message)
  }, [])

  const handleColorChange = useCallback((patch: Partial<EditPipeline['color']>) => {
    setLiveColor((current) => ({ ...current, ...patch }))
  }, [])

  const watermarkLayer = useMemo(() => watermarkSettings.enabled
    ? buildResolvedWatermarkStaticLayer(watermarkSettings, previewDimensions.width, previewDimensions.height)
    : null, [previewDimensions.height, previewDimensions.width, watermarkSettings])
  const watermarkPositioning = useMemo(() => watermarkLayer
    ? resolvePreviewWatermarkPositioning(watermarkLayer, previewDimensions)
    : null, [previewDimensions, watermarkLayer])
  const watermarkSrc = filePathToPreviewUrl(watermarkLayer?.filePath)
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
    sharpen: liveColor.sharpen,
  }), [liveColor])
  const previewWindowSettings = useMemo<LivePreviewWindowSettings>(() => ({
    url: status.localPreviewUrl,
    colorAdjustments: liveColorAdjustments,
    lutPath,
    lutIntensity,
    watermark: watermarkSrc && watermarkPositioning
      ? {
          src: watermarkSrc,
          positioning: watermarkPositioning,
          opacity: watermarkLayer?.opacity ?? 1,
        }
      : null,
  }), [
    liveColorAdjustments,
    lutIntensity,
    lutPath,
    status.localPreviewUrl,
    watermarkLayer?.opacity,
    watermarkPositioning,
    watermarkSrc,
  ])

  useEffect(() => {
    window.luna.updateLivePreviewWindowSettings(previewWindowSettings)
  }, [previewWindowSettings])
  const whiteBalanceModified = liveColor.temperature !== 0 || liveColor.tint !== 0 || liveColor.whiteBalanceMode !== 'custom'
  const toneModified = liveColor.exposure !== 0 || liveColor.brightness !== 0 || liveColor.contrast !== 0
    || liveColor.highlights !== 0 || liveColor.shadows !== 0 || liveColor.whites !== 0 || liveColor.blacks !== 0
    || liveColor.vibrance !== 0 || liveColor.saturation !== 0
  return (
    <section className="live-control-panel" aria-label="直播预览">
      <div ref={previewPaneRef} className="live-preview-pane">
        <div
          className="live-preview-stage"
          data-control-active={activeSettingsPanel === 'control' ? '' : undefined}
          style={{ width: previewStageSize.width, height: previewStageSize.height }}
          onPointerDown={startPreviewGesture}
          onPointerUp={endPreviewGesture}
          onPointerCancel={() => { gestureRef.current = null }}
        >
          {status.localPreviewUrl && (
            <AnnexBVideoCanvas
              url={status.localPreviewUrl}
              lutPath={lutPath}
              lutIntensity={lutIntensity}
              colorAdjustments={liveColorAdjustments}
              className="live-preview-canvas"
              onFrame={handlePreviewFrame}
              onError={handlePreviewError}
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

          {activeSettingsPanel === 'control' && focusPoint && (
            <div className="live-preview-focus-marker" style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }} />
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
                  {busy ? '处理中...' : '重新获取画面'}
                </Button>
              </div>
            </div>
          )}

          {active && !streaming && (
            <div className="live-preview-overlay">
              <strong>{status.state === 'starting' ? '正在启动' : status.usbMessage || '等待手机连接'}</strong>
              {status.state !== 'starting' && !status.usbDeviceLabel && <span>用 USB 连接手机和电脑</span>}
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
        <div className="live-settings-tabs">
          <SegmentedControl
            ariaLabel="直播设置面板"
            className="live-settings-tabs-control"
            options={[
              { value: 'control', label: '控制' },
              { value: 'watermark', label: '水印' },
              { value: 'lut', label: 'LUT' },
              { value: 'color', label: '调色' },
            ]}
            value={activeSettingsPanel}
            onChange={setActiveSettingsPanel}
          />
        </div>
        <div className="live-settings-scroll">
          {activeSettingsPanel === 'lut' ? (
            <FilterPanel
              showRestore={false}
              restoreLutId={null}
              onRestoreChange={() => undefined}
              activeLutId={lutPath}
              onChange={(nextLutPath, intensity) => {
                setLutPath(nextLutPath)
                if (intensity !== undefined) setLutIntensity(intensity)
              }}
              intensity={lutIntensity}
              onIntensityChange={setLutIntensity}
              mediaPath={null}
            />
          ) : activeSettingsPanel === 'watermark' ? (
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
          ) : activeSettingsPanel === 'color' ? (
            <>
              <WhiteBalancePanel
                value={liveColor}
                modified={whiteBalanceModified}
                onChange={handleColorChange}
                onPreviewChange={handleColorChange}
                showPipette={false}
                selectContentClassName="live-settings-select-content"
              />
              <TonePanel
                value={liveColor}
                modified={toneModified}
                onChange={handleColorChange}
                onPreviewChange={handleColorChange}
                includeDetailControls={false}
              />
              <DetailPanel
                value={liveColor}
                modified={liveColor.sharpen !== 0}
                onChange={handleColorChange}
                onPreviewChange={handleColorChange}
                includeDenoise={false}
              />
            </>
          ) : (
            <LiveCameraControlPanel
              status={status}
            />
          )}
        </div>

      </aside>
    </section>
  )
}

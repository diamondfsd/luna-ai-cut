import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Video } from 'lucide-react'

import { Accordion, Button, Switch } from '../ui'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { DEFAULT_PIPELINE, type EditPipeline } from '../workspace/shared/editPipeline'
import { DetailPanel } from '../workspace/color/DetailPanel'
import { TonePanel } from '../workspace/color/TonePanel'
import { WhiteBalancePanel } from '../workspace/color/WhiteBalancePanel'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import { resolveWatermarkPositioning as resolvePreviewWatermarkPositioning, watermarkPositionStyle } from './htmlPreviewGeometry'
import { buildResolvedWatermarkStaticLayer, WatermarkSettings } from './WatermarkSettings'
import type { LiveVideoColorAdjustments } from './LiveVideoWebGpuRenderer'
import type { LivePreviewWindowSettings, LiveStreamStatus } from '../shared/types'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

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
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>({
    enabled: false,
    style: 'luna_ultra_cn',
    position: 'bottom-right',
    sourceKind: 'builtin',
  })
  const [liveColor, setLiveColor] = useState<EditPipeline['color']>(() => structuredClone(DEFAULT_PIPELINE.color))
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
    watermark: watermarkSrc && watermarkPositioning
      ? {
          src: watermarkSrc,
          positioning: watermarkPositioning,
          opacity: watermarkLayer?.opacity ?? 1,
        }
      : null,
  }), [
    liveColorAdjustments,
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
          style={{ width: previewStageSize.width, height: previewStageSize.height }}
        >
          {status.localPreviewUrl && (
            <AnnexBVideoCanvas
              url={status.localPreviewUrl}
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
        </div>

      </aside>
    </section>
  )
}

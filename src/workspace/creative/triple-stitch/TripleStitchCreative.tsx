import { Download, Film, Image as ImageIcon, LayoutTemplate } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceMediaAsset } from '../../../shared/types'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../../../shared/watermarkAssets'
import { Button, SegmentedControl, Select, Switch, toast } from '../../../ui'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import {
  loadCreativeImageSource,
  loadCreativePreviewImageSource,
  loadCreativeVideoSource,
  normalizeCreativePipeline,
  type CreativeSlotTransform,
  type CreativeSlotSource,
} from '../shared/creativeMedia'
import { TripleStitchGLSlot } from './TripleStitchGLSlot'
import { TripleStitchSlotTools } from './TripleStitchSlotTools'
import { TripleStitchTransformPanel } from './TripleStitchTransformPanel'
import { createDefaultPipeline } from '../../shared/editPipeline'
import './triple-stitch.css'

function useTripleStitchSources(media: WorkspaceMediaAsset[], selectedIds: string[]): CreativeSlotSource[] {
  return useMemo(() => selectedIds
    .map((id) => media.find((asset) => asset.id === id))
    .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset))
    .map((asset) => ({
      asset,
      pipeline: normalizeCreativePipeline((asset as { pipeline?: unknown }).pipeline),
    })), [media, selectedIds])
}

const DEFAULT_TRANSFORM: CreativeSlotTransform = { scale: 1, offsetX: 0, offsetY: 0 }
type VideoDuration = '3' | '5' | '10' | '15'
type VideoQuality = 'high' | 'medium' | 'low'
type WatermarkStyle = 'luna_ultra' | 'luna_ultra_cn'

const VIDEO_QUALITY_OPTIONS: Array<{ value: VideoQuality; label: string }> = [
  { value: 'high', label: '高 (4K 50M)' },
  { value: 'medium', label: '中 (2K 30M)' },
  { value: 'low', label: '低 (1080P 20M)' },
]

export function TripleStitchCreative() {
  const media = useWorkspaceMedia()
  const watermarkRef = useRef<HTMLImageElement | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => media.media.slice(0, 3).map((asset) => asset.id))
  const [activeSlot, setActiveSlot] = useState(0)
  const [watermarkEnabled, setWatermarkEnabled] = useState(true)
  const [watermarkStyle, setWatermarkStyle] = useState<WatermarkStyle>('luna_ultra_cn')
  const [exportLiveImage, setExportLiveImage] = useState(true)
  const [exportVideo, setExportVideo] = useState(false)
  const [exportAppleLive, setExportAppleLive] = useState(false)
  const [videoDuration, setVideoDuration] = useState<VideoDuration>('5')
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('high')
  const [busy, setBusy] = useState(false)
  const [previewSources, setPreviewSources] = useState<Array<HTMLImageElement | HTMLVideoElement>>([])
  const [slotDurations, setSlotDurations] = useState([0, 0, 0])
  const [slotTransforms, setSlotTransforms] = useState<CreativeSlotTransform[]>([
    { ...DEFAULT_TRANSFORM },
    { ...DEFAULT_TRANSFORM },
    { ...DEFAULT_TRANSFORM },
  ])
  const [liveStarts, setLiveStarts] = useState([0, 0, 0])
  const dragRef = useRef<{ slot: number; x: number; y: number; startX: number; startY: number; ratio: number } | null>(null)
  const slotSources = useTripleStitchSources(media.media, selectedIds)
  const watermarkOptions = useMemo(() => watermarkStyleOptionsForDevice('luna-ultra').map(({ value, label }) => ({ value, label })), [])
  const isMac = /Mac/i.test(navigator.platform)
  const canExport = slotSources.length === 3 && (exportLiveImage || exportVideo || exportAppleLive)
  const activeTransform = slotTransforms[activeSlot] ?? DEFAULT_TRANSFORM

  useEffect(() => {
    const src = WM_SRC[watermarkStyle]?.image
    if (!src) return
    const img = new Image()
    img.onload = () => { watermarkRef.current = img }
    img.src = src
  }, [watermarkStyle])

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = current.filter((id) => media.media.some((asset) => asset.id === id))
      const fill = media.media.filter((asset) => !valid.includes(asset.id)).slice(0, 3 - valid.length).map((asset) => asset.id)
      return [...valid, ...fill].slice(0, 3)
    })
  }, [media.media])

  useEffect(() => {
    function handleStripClick(event: Event): void {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index
      if (index == null) return
      const asset = media.media[index]
      if (!asset) return
      setSelectedIds((current) => {
        const next = [...current]
        next[activeSlot] = asset.id
        return next.slice(0, 3)
      })
    }

    window.addEventListener('workspace-media-strip-click', handleStripClick)
    return () => window.removeEventListener('workspace-media-strip-click', handleStripClick)
  }, [activeSlot, media.media])

  function updateSlotTransform(slot: number, patch: Partial<CreativeSlotTransform>): void {
    setSlotTransforms((current) => current.map((item, index) => (
      index === slot ? { ...item, ...patch } : item
    )))
  }

  function swapSlots(from: number, to: number): void {
    if (to < 0 || to > 2) return
    setSelectedIds((current) => {
      const next = [...current]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setSlotTransforms((current) => {
      const next = current.map((item) => ({ ...item }))
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setLiveStarts((current) => {
      const next = [...current]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setSlotDurations((current) => {
      const next = [...current]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setActiveSlot(to)
  }

  function resetActiveTransform(): void {
    updateSlotTransform(activeSlot, DEFAULT_TRANSFORM)
  }

  function resetSlot(slot: number): void {
    updateSlotTransform(slot, DEFAULT_TRANSFORM)
    updateLiveStart(slot, 0)
    setActiveSlot(slot)
  }

  function zoomSlot(slot: number): void {
    const current = slotTransforms[slot] ?? DEFAULT_TRANSFORM
    updateSlotTransform(slot, { scale: Math.min(3, Number((current.scale + 0.1).toFixed(2))) })
    setActiveSlot(slot)
  }

  function updateLiveStart(slot: number, value: number): void {
    const maxStart = Math.max(0, (slotDurations[slot] || 33) - 3)
    const nextValue = Math.min(maxStart, Math.max(0, value))
    setLiveStarts((current) => current.map((item, index) => (index === slot ? nextValue : item)))
    const source = previewSources[slot]
    if (source instanceof HTMLVideoElement) {
      source.currentTime = nextValue
      void source.play().catch(() => undefined)
    }
  }

  function slotFromPointer(event: React.PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.min(rect.height - 1, Math.max(0, event.clientY - rect.top))
    return Math.floor(y / (rect.height / 3))
  }

  function handleBoardPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.triple-stitch-slot-tool')) return
    const slot = slotFromPointer(event)
    const current = slotTransforms[slot] ?? DEFAULT_TRANSFORM
    setActiveSlot(slot)
    dragRef.current = {
      slot,
      x: event.clientX,
      y: event.clientY,
      startX: current.offsetX,
      startY: current.offsetY,
      ratio: Math.min(window.devicePixelRatio || 1, 2),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleBoardPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag) return
    updateSlotTransform(drag.slot, {
      offsetX: drag.startX + (event.clientX - drag.x) * drag.ratio,
      offsetY: drag.startY + (event.clientY - drag.y) * drag.ratio,
    })
  }

  function handleBoardPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  // Watermark is no longer rendered on the preview canvas — it's applied during export

  useEffect(() => {
    let canceled = false
    Promise.all(slotSources.map(async ({ asset, pipeline }) => {
      const source = await (asset.kind === 'video' || asset.isLivePhoto
        ? loadCreativeVideoSource(asset)
        : loadCreativeImageSource(asset, pipeline)
      ).catch(() => loadCreativePreviewImageSource(asset))
      return source
    }))
      .then((sources) => {
        if (canceled) return
        setPreviewSources(sources)
        setSlotDurations(sources.map((source) => (
          source instanceof HTMLVideoElement && Number.isFinite(source.duration) ? source.duration : 0
        )))
        for (const source of sources) {
          if (source instanceof HTMLVideoElement) void source.play().catch(() => undefined)
        }
      })
      .catch(() => {
        if (!canceled) setPreviewSources([])
      })
    return () => { canceled = true }
  }, [slotSources])

  useEffect(() => {
    const source = previewSources[activeSlot]
    if (!(source instanceof HTMLVideoElement)) return
    const start = liveStarts[activeSlot] ?? 0
    const end = start + 3
    source.currentTime = start
    void source.play().catch(() => undefined)
    let raf = 0
    const tick = () => {
      if (source.currentTime >= end || source.currentTime < start) source.currentTime = start
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => window.cancelAnimationFrame(raf)
  }, [activeSlot, liveStarts, previewSources])

  async function handleExport(): Promise<void> {
    if (!canExport || busy) return
    setBusy(true)
    try {
      await window.luna.workspace.exportTripleStitch({
        name: `triple-stitch-${Date.now()}`,
        slots: slotSources.map(({ asset, pipeline }, index) => ({
          name: asset.name,
          path: asset.path,
          kind: asset.kind,
          isLivePhoto: asset.isLivePhoto,
          transform: slotTransforms[index] ?? DEFAULT_TRANSFORM,
          liveStart: liveStarts[index] ?? 0,
          pipeline: pipeline as unknown as Record<string, unknown>,
        })),
        watermarkEnabled,
        watermarkStyle,
        outputs: {
          liveImage: exportLiveImage,
          video: exportVideo,
          appleLivePhoto: exportAppleLive,
        },
        videoDuration: Number(videoDuration),
        videoQuality,
      })
      toast.success('已加入导出任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="triple-stitch-page">
      <div className="triple-stitch-preview">
        <div className="triple-stitch-board">
          <div
            className="triple-stitch-slot-buttons"
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={handleBoardPointerUp}
            onPointerCancel={handleBoardPointerUp}
          >
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`triple-stitch-slot-button${activeSlot === index ? ' active' : ''}`}
                onClick={() => setActiveSlot(index)}
              >
                <TripleStitchGLSlot
                  source={previewSources[index] ?? null}
                  pipeline={slotSources[index]?.pipeline ?? createDefaultPipeline()}
                  transform={slotTransforms[index]}
                />
                <TripleStitchSlotTools
                  slot={index}
                  onMove={swapSlots}
                  onZoom={zoomSlot}
                  onReset={resetSlot}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <TripleStitchTransformPanel
        activeSlot={activeSlot}
        transform={activeTransform}
        onChange={updateSlotTransform}
        onReset={resetActiveTransform}
        dynamic={slotSources[activeSlot]?.asset.kind === 'video' || Boolean(slotSources[activeSlot]?.asset.isLivePhoto)}
        duration={slotDurations[activeSlot] ?? 0}
        liveStart={liveStarts[activeSlot] ?? 0}
        onLiveChange={(value) => updateLiveStart(activeSlot, value)}
      />
      <aside className="triple-stitch-panel">
        <div className="triple-stitch-panel-head">
          <LayoutTemplate size={18} />
          <div>
            <strong>Live 三拼</strong>
            <span>选择画布分段后，点击底部素材替换</span>
          </div>
        </div>

        <label className="triple-stitch-switch-row">
          <span>设备水印</span>
          <Switch checked={watermarkEnabled} onCheckedChange={setWatermarkEnabled} ariaLabel="设备水印" />
        </label>
        {watermarkEnabled && (
          <div className="triple-stitch-select-row">
            <span>水印样式</span>
            <Select
              variant="compact"
              options={watermarkOptions}
              value={watermarkStyle}
              onValueChange={(value) => setWatermarkStyle(value as WatermarkStyle)}
            />
          </div>
        )}

        <div className="triple-stitch-export-panel">
          <div className="triple-stitch-section-title">导出项</div>
          <label className="triple-stitch-switch-row">
            <span><ImageIcon size={15} /> Live 图片</span>
            <Switch checked={exportLiveImage} onCheckedChange={setExportLiveImage} ariaLabel="Live 图片" />
          </label>
          <label className="triple-stitch-switch-row">
            <span><Film size={15} /> 视频</span>
            <Switch checked={exportVideo} onCheckedChange={setExportVideo} ariaLabel="视频" />
          </label>
          {exportVideo && (
            <>
              <SegmentedControl<VideoDuration>
                value={videoDuration}
                onChange={setVideoDuration}
                options={[
                  { value: '3', label: '3 秒' },
                  { value: '5', label: '5 秒' },
                  { value: '10', label: '10 秒' },
                  { value: '15', label: '15 秒' },
                ]}
              />
              <div className="triple-stitch-select-row">
                <span>视频质量</span>
                <Select
                  variant="compact"
                  options={VIDEO_QUALITY_OPTIONS}
                  value={videoQuality}
                  onValueChange={(value) => setVideoQuality(value as VideoQuality)}
                />
              </div>
            </>
          )}
          <label className="triple-stitch-switch-row">
            <span><ImageIcon size={15} /> Apple Live 图</span>
            <Switch
              checked={exportAppleLive}
              onCheckedChange={(checked) => {
                if (checked && !isMac) {
                  toast.error('Apple Live 图仅支持在 Mac 上导出')
                  return
                }
                setExportAppleLive(checked)
              }}
              ariaLabel="Apple Live 图"
            />
          </label>
        </div>

        <div className="triple-stitch-actions">
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!canExport || busy} onClick={() => void handleExport()}>
            {busy ? '导出中' : '导出'}
          </Button>
        </div>
      </aside>
    </section>
  )
}

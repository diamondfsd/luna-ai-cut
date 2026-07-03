import { Download, Film, Image as ImageIcon, LayoutTemplate } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceMediaAsset } from '../../../shared/types'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../../../shared/watermarkAssets'
import { Button, SegmentedControl, Select, Switch, toast } from '../../../ui'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import {
  drawCoverImage,
  loadCreativeImageAspect,
  loadCreativeImageSource,
  loadCreativePreviewImageSource,
  loadCreativeVideoSource,
  normalizeCreativePipeline,
  type CreativeSlotTransform,
  type CreativeSlotSource,
} from '../shared/creativeMedia'
import { TripleStitchLiveRangeBar } from './TripleStitchLiveRangeBar'
import { TripleStitchSlotTools } from './TripleStitchSlotTools'
import { TripleStitchTransformPanel } from './TripleStitchTransformPanel'
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
  const [watermarkReady, setWatermarkReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [previewSources, setPreviewSources] = useState<Array<HTMLImageElement | HTMLVideoElement>>([])
  const [sourceAspects, setSourceAspects] = useState<Array<number | null>>([])
  const [slotDurations, setSlotDurations] = useState([0, 0, 0])
  const [liveRangeSlot, setLiveRangeSlot] = useState<number | null>(null)
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
    setWatermarkReady(false)
    const src = WM_SRC[watermarkStyle]?.image
    if (!src) return
    const img = new Image()
    img.onload = () => {
      watermarkRef.current = img
      setWatermarkReady(true)
    }
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

  function openLiveRange(slot: number): void {
    setActiveSlot(slot)
    setLiveRangeSlot(slot)
    updateLiveStart(slot, liveStarts[slot] ?? 0)
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
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = event.currentTarget.getBoundingClientRect()
    const current = slotTransforms[slot] ?? DEFAULT_TRANSFORM
    setActiveSlot(slot)
    dragRef.current = {
      slot,
      x: event.clientX,
      y: event.clientY,
      startX: current.offsetX,
      startY: current.offsetY,
      ratio: canvas.width / rect.width,
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

  const renderCanvas = useCallback((options?: { sources?: Array<HTMLImageElement | HTMLVideoElement>; drawWatermark?: boolean }) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const slotHeight = canvas.height / 3
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const watermark = options?.drawWatermark !== false && watermarkEnabled ? watermarkRef.current : null

    for (let index = 0; index < 3; index += 1) {
      const y = index * slotHeight
      ctx.fillStyle = '#1d1d1d'
      ctx.fillRect(0, y, width, slotHeight)
      const source = options?.sources?.[index]
      if (source) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, y, width, slotHeight)
        ctx.clip()
        drawCoverImage(ctx, source, { x: 0, y, width, height: slotHeight }, slotTransforms[index], sourceAspects[index] ?? undefined)
        if (watermark) {
          const wmWidth = width * 0.3
          const wmHeight = wmWidth * (watermark.naturalHeight / watermark.naturalWidth)
          const bottomPadding = Math.max(34, slotHeight * 0.075)
          ctx.drawImage(watermark, (width - wmWidth) / 2, y + slotHeight - wmHeight - bottomPadding, wmWidth, wmHeight)
        }
        ctx.restore()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 2
      if (index > 0) ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(width, y), ctx.stroke()
    }
  }, [slotTransforms, sourceAspects, watermarkEnabled, watermarkReady])

  useEffect(() => {
    let canceled = false
    Promise.all(slotSources.map(async ({ asset, pipeline }) => {
      const source = await (asset.kind === 'video' || asset.isLivePhoto
        ? loadCreativeVideoSource(asset)
        : loadCreativeImageSource(asset, pipeline)
      ).catch(() => loadCreativePreviewImageSource(asset))
      const aspect = asset.kind === 'image' && !asset.isLivePhoto
        ? await loadCreativeImageAspect(asset)
        : source instanceof HTMLVideoElement
        ? source.videoWidth / source.videoHeight
        : source.naturalWidth / source.naturalHeight
      return { source, aspect: typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : null }
    }))
      .then((items) => {
        if (canceled) return
        const sources = items.map((item) => item.source)
        setPreviewSources(sources)
        setSourceAspects(items.map((item) => item.aspect))
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
    if (liveRangeSlot == null) return
    const source = previewSources[liveRangeSlot]
    if (!(source instanceof HTMLVideoElement)) return
    const start = liveStarts[liveRangeSlot] ?? 0
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
  }, [liveRangeSlot, liveStarts, previewSources])

  useEffect(() => {
    const hasVideo = previewSources.some((source) => source instanceof HTMLVideoElement)
    if (!hasVideo) {
      renderCanvas({ sources: previewSources })
      return
    }
    let raf = 0
    const tick = () => {
      renderCanvas({ sources: previewSources })
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => window.cancelAnimationFrame(raf)
  }, [previewSources, renderCanvas])

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
          <canvas ref={canvasRef} width={1080} height={1920} className="triple-stitch-canvas" />
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
                <TripleStitchSlotTools
                  slot={index}
                  dynamic={slotSources[index]?.asset.kind === 'video' || Boolean(slotSources[index]?.asset.isLivePhoto)}
                  onMove={swapSlots}
                  onZoom={zoomSlot}
                  onReset={resetSlot}
                  onLiveRange={openLiveRange}
                />
              </div>
            ))}
          </div>
          {liveRangeSlot != null && previewSources[liveRangeSlot] instanceof HTMLVideoElement && (
            <TripleStitchLiveRangeBar
              slot={liveRangeSlot}
              duration={slotDurations[liveRangeSlot] || 33}
              value={liveStarts[liveRangeSlot] ?? 0}
              onChange={(value) => updateLiveStart(liveRangeSlot, value)}
              onClose={() => setLiveRangeSlot(null)}
            />
          )}
        </div>
      </div>

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
      <TripleStitchTransformPanel
        activeSlot={activeSlot}
        transform={activeTransform}
        onChange={updateSlotTransform}
        onReset={resetActiveTransform}
      />
    </section>
  )
}

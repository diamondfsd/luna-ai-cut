import { ArrowDown, ArrowUp, Download, Film, Image as ImageIcon, LayoutTemplate, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import watermarkUrl from '../../../assets/watermark/ic_watermark_luna_ultra_image_cn.png'
import type { WorkspaceMediaAsset } from '../../../shared/types'
import { Button, IconButton, SegmentedControl, Switch, toast } from '../../../ui'
import { blobToDataURL } from '../../export/exportImageWithWebGL'
import { ParamSlider } from '../../components/ParamSlider'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import {
  drawCoverImage,
  loadCreativeImageSource,
  loadCreativePreviewImageSource,
  loadCreativeVideoSource,
  normalizeCreativePipeline,
  type CreativeSlotTransform,
  type CreativeSlotSource,
} from '../shared/creativeMedia'
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

export function TripleStitchCreative() {
  const media = useWorkspaceMedia()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const watermarkRef = useRef<HTMLImageElement | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => media.media.slice(0, 3).map((asset) => asset.id))
  const [activeSlot, setActiveSlot] = useState(0)
  const [watermarkEnabled, setWatermarkEnabled] = useState(true)
  const [exportLiveImage, setExportLiveImage] = useState(true)
  const [exportVideo, setExportVideo] = useState(false)
  const [exportAppleLive, setExportAppleLive] = useState(false)
  const [videoDuration, setVideoDuration] = useState<VideoDuration>('5')
  const [watermarkReady, setWatermarkReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [previewSources, setPreviewSources] = useState<Array<HTMLImageElement | HTMLVideoElement>>([])
  const [slotTransforms, setSlotTransforms] = useState<CreativeSlotTransform[]>([
    { ...DEFAULT_TRANSFORM },
    { ...DEFAULT_TRANSFORM },
    { ...DEFAULT_TRANSFORM },
  ])
  const dragRef = useRef<{ slot: number; x: number; y: number; startX: number; startY: number; ratio: number } | null>(null)
  const slotSources = useTripleStitchSources(media.media, selectedIds)
  const isMac = /Mac/i.test(navigator.platform)
  const canExport = slotSources.length === 3 && (exportLiveImage || exportVideo || exportAppleLive)
  const activeTransform = slotTransforms[activeSlot] ?? DEFAULT_TRANSFORM

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      watermarkRef.current = img
      setWatermarkReady(true)
    }
    img.src = watermarkUrl
  }, [])

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
    setActiveSlot(to)
  }

  function resetActiveTransform(): void {
    updateSlotTransform(activeSlot, DEFAULT_TRANSFORM)
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
        drawCoverImage(ctx, source, { x: 0, y, width, height: slotHeight }, slotTransforms[index])
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
  }, [slotTransforms, watermarkEnabled, watermarkReady])

  useEffect(() => {
    let canceled = false
    Promise.all(slotSources.map(({ asset }) => (
      asset.kind === 'video' || asset.isLivePhoto
        ? loadCreativeVideoSource(asset)
        : loadCreativePreviewImageSource(asset)
    ).catch(() => loadCreativePreviewImageSource(asset))))
      .then((sources) => {
        if (canceled) return
        setPreviewSources(sources)
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

  async function buildSources(): Promise<Array<HTMLImageElement | HTMLVideoElement>> {
    return Promise.all(slotSources.map(async ({ asset, pipeline }) => (
      asset.kind === 'video' || asset.isLivePhoto ? loadCreativeVideoSource(asset) : loadCreativeImageSource(asset, pipeline)
    )))
  }

  async function recordVideo(sources: Array<HTMLImageElement | HTMLVideoElement>, seconds: number): Promise<string> {
    const canvas = canvasRef.current
    if (!canvas) throw new Error('画布尚未准备好')
    for (const source of sources) {
      if (source instanceof HTMLVideoElement) {
        source.currentTime = 0
        await source.play().catch(() => undefined)
      }
    }

    const stream = canvas.captureStream(30)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    let raf = 0
    const tick = () => {
      renderCanvas({ sources })
      raf = window.requestAnimationFrame(tick)
    }
    tick()

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.start()
      window.setTimeout(() => recorder.stop(), seconds * 1000)
    })
    window.cancelAnimationFrame(raf)

    return blobToDataURL(new Blob(chunks, { type: 'video/webm' }))
  }

  async function handleExport(): Promise<void> {
    if (!canExport || busy) return
    setBusy(true)
    try {
      const sources = await buildSources()
      renderCanvas({ sources })
      const canvas = canvasRef.current
      if (!canvas) return
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.94)
      let liveVideoDataUrl: string | null = null

      if (exportLiveImage || exportAppleLive) {
        liveVideoDataUrl = await recordVideo(sources, 3)
      }
      if (exportLiveImage && liveVideoDataUrl) {
        await window.luna.workspace.exportCreativeLivePhoto(`live-triple-${Date.now()}`, imageDataUrl, liveVideoDataUrl, false)
      }
      if (exportAppleLive && liveVideoDataUrl) {
        await window.luna.workspace.exportCreativeLivePhoto(`apple-live-triple-${Date.now()}`, imageDataUrl, liveVideoDataUrl, true)
      }
      if (exportVideo) {
        const videoDataUrl = Number(videoDuration) === 3 && liveVideoDataUrl
          ? liveVideoDataUrl
          : await recordVideo(sources, Number(videoDuration))
        await window.luna.workspace.exportCreativeDataUrl(`triple-video-${Date.now()}`, videoDataUrl, 'video')
      }
      toast.success('已完成导出')
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
                <div className="triple-stitch-slot-tools">
                  <IconButton
                    className="triple-stitch-slot-tool"
                    variant="light"
                    size="mini"
                    icon={<ArrowUp size={13} />}
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation()
                      swapSlots(index, index - 1)
                    }}
                    title="上移"
                  />
                  <IconButton
                    className="triple-stitch-slot-tool"
                    variant="light"
                    size="mini"
                    icon={<ArrowDown size={13} />}
                    disabled={index === 2}
                    onClick={(event) => {
                      event.stopPropagation()
                      swapSlots(index, index + 1)
                    }}
                    title="下移"
                  />
                </div>
              </div>
            ))}
          </div>
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

        <div className="triple-stitch-transform-panel">
          <div className="triple-stitch-section-title">第 {activeSlot + 1} 段画面</div>
          <ParamSlider
            label="缩放"
            value={activeTransform.scale}
            min={1}
            max={3}
            step={0.05}
            onChange={(value) => updateSlotTransform(activeSlot, { scale: value })}
            formatValue={(value) => value.toFixed(2)}
          />
          <ParamSlider
            label="左右"
            value={Math.round(activeTransform.offsetX)}
            min={-540}
            max={540}
            step={1}
            onChange={(value) => updateSlotTransform(activeSlot, { offsetX: value })}
          />
          <ParamSlider
            label="上下"
            value={Math.round(activeTransform.offsetY)}
            min={-320}
            max={320}
            step={1}
            onChange={(value) => updateSlotTransform(activeSlot, { offsetY: value })}
          />
          <Button variant="secondary" size="compact" icon={<RotateCcw size={14} />} onClick={resetActiveTransform}>
            重置画面
          </Button>
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

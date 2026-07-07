import { useState, useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { Play, Pause } from 'lucide-react'
import { LrcRender } from './LrcRender'
import { emitLocalExportProgress, exportPreviewImage, exportPreviewLivePhoto, exportPreviewVideo } from './previewStageExport'
import type { PreviewLayer } from '../shared/types'
import { useIsLivePhoto } from '../shared/livePhoto'
import { LivePhotoBadge } from '../ui'
import { baseNameFromPath, isImagePath, isVideoPath } from '../lib/fileUtils'
import type { EditPipeline } from '../workspace/shared/editPipeline'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../workspace/shared/renderLayerPipeline'
import './PreviewStage.css'

interface PreviewStageProps {
  url: string | null
  pending?: boolean
  extraLayers?: PreviewLayer[]
  exportOptions?: ExportOptions
  pipeline?: EditPipeline
  cropActive?: boolean
  onMetricsChange?: (metrics: { imageRect: { x: number; y: number; width: number; height: number }; sourceAspect: number }) => void
  onMediaSize?: (width: number, height: number) => void
  renderOverlay?: () => ReactNode
}

export interface MediaResolution {
  width: number
  height: number
}

export interface ExportOptions {
  enable: boolean
  format?: 'jpeg' | 'png' | 'webp'
  quality?: number
}

export interface PreviewStageHandle {
  export(): Promise<{ path: string; name: string }>
}

interface StageSize {
  width: number
  height: number
}

function isValidSize(size: MediaResolution | StageSize | null): size is MediaResolution | StageSize {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}

function containFrame(media: MediaResolution, stage: StageSize): Pick<PreviewLayer, 'dstX' | 'dstY' | 'dstW' | 'dstH'> {
  const mediaAspect = media.width / media.height
  const stageAspect = stage.width / stage.height

  if (stageAspect > mediaAspect) {
    const dstW = mediaAspect / stageAspect
    return { dstX: (1 - dstW) / 2, dstY: 0, dstW, dstH: 1 }
  }

  const dstH = stageAspect / mediaAspect
  return { dstX: 0, dstY: (1 - dstH) / 2, dstW: 1, dstH }
}

export function buildLayers(
  url: string,
  resolution: MediaResolution | null = null,
  stageSize: StageSize | null = null,
): PreviewLayer[] {
  const hasMeasuredFrame = isValidSize(resolution) && isValidSize(stageSize)
  const frame = hasMeasuredFrame
    ? containFrame(resolution, stageSize)
    : { dstX: 0, dstY: 0, dstW: 1, dstH: 1 }
  const baseLayer = { ...frame, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }

  if (isImagePath(url)) {
    return [{ ...baseLayer, filePath: url }]
  }
  if (isVideoPath(url)) {
    return [{ ...baseLayer, filePath: url, isVideo: true }]
  }
  return []
}

export function calcAspectRatio(width: number, height: number): number {
  if (height === 0) return 1
  return Math.round((width / height) * 100) / 100
}

function projectCanvasFor(resolution: MediaResolution | null): StageSize | null {
  if (!resolution) return null
  const MAX = 1440
  const aspect = resolution.width / resolution.height
  if (aspect >= 1) {
    return { width: MAX, height: Math.round(MAX / aspect) }
  }
  return { width: Math.round(MAX * aspect), height: MAX }
}

export const PreviewStage = forwardRef<PreviewStageHandle, PreviewStageProps>(function PreviewStage(
  { url, pending = false, extraLayers, exportOptions, pipeline, cropActive, onMetricsChange, onMediaSize, renderOverlay },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // ── 媒体分辨率 ──
  const [resolution, setResolution] = useState<MediaResolution | null>(null)

  // ── 加载状态（url 切换时自动 loading） ──
  const [loading, setLoading] = useState(false)
  const prevUrlRef = useRef<string | null>(null)

  // ── 视频控件状态 ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const isLivePhoto = useIsLivePhoto(url)
  const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null)
  const [liveVideoLoading, setLiveVideoLoading] = useState(false)
  const [livePlaying, setLivePlaying] = useState(false)
  const displayUrl = livePlaying && liveVideoUrl ? liveVideoUrl : url
  const isDisplayVideo = displayUrl ? isVideoPath(displayUrl) : false
  const layoutUrl = livePlaying && liveVideoUrl ? url : displayUrl

  // 暴露 video 元素并绑定事件
  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    if (videoRef.current === el) return
    // 解绑旧元素
    if (videoRef.current) {
      videoRef.current.onplay = null
      videoRef.current.onpause = null
      videoRef.current.ontimeupdate = null
      videoRef.current.onloadedmetadata = null
      videoRef.current.onended = null
    }
    videoRef.current = el
    if (el) {
      setPlaying(!el.paused)
      setCurrentTime(el.currentTime)
      setDuration(el.duration || 0)
      el.onplay = () => setPlaying(true)
      el.onpause = () => setPlaying(false)
      el.ontimeupdate = () => setCurrentTime(el.currentTime)
      el.onloadedmetadata = () => setDuration(el.duration || 0)
      el.onended = () => {
        setPlaying(false)
        setCurrentTime(el.duration || el.currentTime)
        if (livePlaying) setLivePlaying(false)
      }
      if (livePlaying && isDisplayVideo) {
        el.currentTime = 0
        el.play().catch(() => {})
      }
    } else {
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
  }, [livePlaying, isDisplayVideo])

  useEffect(() => {
    let canceled = false
    setLivePlaying(false)
    setLiveVideoUrl(null)
    if (!isLivePhoto || !url) return

    setLiveVideoLoading(true)
    window.luna.previewLivePhoto(url)
      .then((result) => {
        if (!canceled) setLiveVideoUrl(result.source ?? null)
      })
      .catch(() => {
        if (!canceled) setLiveVideoUrl(null)
      })
      .finally(() => {
        if (!canceled) setLiveVideoLoading(false)
      })

    return () => {
      canceled = true
    }
  }, [url, isLivePhoto])

  function togglePlay() {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
    } else {
      videoRef.current.pause()
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const time = Number(e.target.value)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
    setCurrentTime(time)
  }

  function toggleLivePhoto() {
    if (!liveVideoUrl) return
    setLivePlaying((current) => !current)
  }

  function formatTime(t: number): string {
    if (!Number.isFinite(t) || t < 0) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  useEffect(() => {
    if (!livePlaying || !isDisplayVideo || !videoRef.current) return
    videoRef.current.currentTime = 0
    videoRef.current.play().catch(() => {})
  }, [livePlaying, isDisplayVideo, displayUrl])

  // url 变化时显示 loading，onRender 时取消
  useEffect(() => {
    if (!displayUrl) { setLoading(false); return }
    if (displayUrl !== prevUrlRef.current) {
      prevUrlRef.current = displayUrl
      setLoading(true)
    }
  }, [displayUrl])

  useEffect(() => {
    if (pending) setLoading(true)
  }, [pending])

  function handleRender() {
    setLoading(false)
  }

  // 宽高比（由 resolution 派生）
  const aspectRatio = useMemo(() => {
    if (!resolution) return null
    return calcAspectRatio(resolution.width, resolution.height)
  }, [resolution])
  const previewCanvas = useMemo(() => projectCanvasFor(resolution), [resolution])

  const buildAdjustedLayers = useCallback((sourceUrl: string | null, layerResolution = resolution): PreviewLayer[] => {
    // 基于 Project Canvas 计算布局，Stage 不参与
    const canvas = projectCanvasFor(layerResolution) ?? { width: 1440, height: 1440 }
    const main = sourceUrl ? buildLayers(sourceUrl, layerResolution, canvas) : []
    if (main[0] && pipeline) {
      const renderTransform = pipelineTransformToRenderTransform(pipeline.transform)
      console.log('[PreviewStage] apply pipeline transform to layer', {
        filePath: main[0].filePath,
        pipelineCrop: pipeline.transform.crop,
        renderTransform,
        cropAspectRatio: pipeline.transform.crop
          ? Math.round((pipeline.transform.crop.w / pipeline.transform.crop.h) * 100) / 100
          : null,
      })
      main[0] = {
        ...main[0],
        color: pipelineColorToRenderColor(pipeline.color),
        transform: renderTransform,
      }
    }
    const m = main[0]
    if (!m) {
      if (extraLayers?.length) {
        console.log('[PreviewStage] skip overlay-only render', { sourceUrl, extraLayers: extraLayers.length })
      }
      return main
    }
    if (!extraLayers?.length) return main

    const cX = m?.dstX ?? 0
    const cY = m?.dstY ?? 0
    const cW = m?.dstW ?? 1
    const cH = m?.dstH ?? 1
    const adjusted = extraLayers.map((l) => ({
      ...l,
      dstX: cX + l.dstX * cW,
      dstY: cY + l.dstY * cH,
      dstW: l.dstW * cW,
      dstH: l.dstH * cH,
    }))
    const finalLayers = [...main, ...adjusted]
    console.log('[PreviewStage] build adjusted layers', {
      sourceUrl,
      resolution: layerResolution ? `${layerResolution.width}x${layerResolution.height}` : null,
      canvas,
      main,
      extraLayers,
      finalLayers,
    })
    return finalLayers
  }, [resolution, extraLayers, pipeline])

  const layers = useMemo(() => {
    if (pending || !resolution) return []
    const nextLayers = buildAdjustedLayers(displayUrl, resolution)
    console.log('[PreviewStage] render layers', {
      displayUrl,
      layoutUrl,
      pending,
      resolution: `${resolution.width}x${resolution.height}`,
      layers: nextLayers,
    })
    return nextLayers
  }, [buildAdjustedLayers, displayUrl, resolution, livePlaying, pending])

  // 通过 IPC 获取媒体文件实际分辨率
  useEffect(() => {
    if (!layoutUrl) {
      setResolution(null)
      return
    }
    let canceled = false
    setResolution(null)
    window.luna.workspace.getMediaResolution(layoutUrl)
      .then((res) => {
        if (canceled) return
        setResolution(res)
      })
      .catch(() => {
        if (!canceled) setResolution(null)
      })
    return () => {
      canceled = true
    }
  }, [layoutUrl])

  useEffect(() => {
    if (!resolution) return
    onMediaSize?.(resolution.width, resolution.height)
  }, [resolution, onMediaSize])

  useEffect(() => {
    const stage = stageRef.current
    const wrapper = wrapperRef.current
    const mainLayer = layers[0]
    if (!stage || !wrapper || !resolution || !mainLayer) return

    const stageRect = stage.getBoundingClientRect()
    // 使用 canvas 实际渲染位置，而非 project canvas 的 letterbox 计算。
    // canvas 在 DOM 中会被 CSS max-width/max-height 居中/缩放，
    // 与 project canvas 尺寸不一定一致，直接读 DOM 坐标更准确。
    const canvas = wrapper.querySelector('canvas')
    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect()
      onMetricsChange?.({
        sourceAspect: resolution.width / resolution.height,
        imageRect: {
          x: canvasRect.left - stageRect.left,
          y: canvasRect.top - stageRect.top,
          width: canvasRect.width,
          height: canvasRect.height,
        },
      })
    } else {
      const wrapperRect = wrapper.getBoundingClientRect()
      onMetricsChange?.({
        sourceAspect: resolution.width / resolution.height,
        imageRect: {
          x: wrapperRect.left - stageRect.left + mainLayer.dstX * wrapperRect.width,
          y: wrapperRect.top - stageRect.top + mainLayer.dstY * wrapperRect.height,
          width: mainLayer.dstW * wrapperRect.width,
          height: mainLayer.dstH * wrapperRect.height,
        },
      })
    }
  }, [onMetricsChange, layers, resolution])

  // 暴露导出方法
  useImperativeHandle(ref, () => ({
    async export() {
      if (!exportOptions?.enable) throw new Error('导出未启用')
      if (!displayUrl) throw new Error('预览内容未就绪')

      // 从设置中获取导出目录
      const settings = await window.luna.getSettings()
      const exportDir = settings.exportDir
      if (!exportDir) throw new Error('导出目录未配置')

      const res = await window.luna.workspace.getMediaResolution(displayUrl)
      const baseName = baseNameFromPath(displayUrl)
      const exportingVideo = isVideoPath(displayUrl)
      const format = exportOptions.format || 'jpeg'
      const ext = exportingVideo ? 'mp4' : format === 'jpeg' ? 'jpg' : format
      const filename = `${baseName}_${Date.now()}.${ext}`
      const outputPath = exportDir.endsWith('/') ? `${exportDir}${filename}` : `${exportDir}/${filename}`
      const exportLayers = buildAdjustedLayers(displayUrl, res)
      const itemId = `preview_${baseName}_${Date.now()}`
      const task = await window.luna.exportTask.create('单帧导出', [
        { id: itemId, sourcePath: displayUrl, outputPath },
      ])
      emitLocalExportProgress({
        exportId: itemId, taskId: task.id, taskName: task.name, fileName: filename,
        index: 0, totalFiles: 1, percent: 0, status: 'queued', destinationPath: outputPath,
      })

      if (isLivePhoto && url) {
        let exportLiveVideoUrl = liveVideoUrl
        if (!exportLiveVideoUrl) {
          const result = await window.luna.previewLivePhoto(url)
          exportLiveVideoUrl = result.source ?? null
          setLiveVideoUrl(exportLiveVideoUrl)
        }
        if (!exportLiveVideoUrl) throw new Error('Live 图视频还未准备好')

        const liveResolution = await window.luna.workspace.getMediaResolution(url)
        return exportPreviewLivePhoto({
          name: baseName,
          exportDir,
          width: liveResolution.width,
          height: liveResolution.height,
          imageLayers: buildAdjustedLayers(url, liveResolution),
          videoLayers: buildAdjustedLayers(exportLiveVideoUrl, liveResolution),
          appleLivePhoto: Boolean(settings.exportAppleLivePhoto),
        })
      }

      if (exportingVideo) {
        return exportPreviewVideo({
          exportDir, fileName: filename, width: res.width, height: res.height,
          layers: exportLayers, qualityPreset: 'high',
          exportTaskId: task.id, exportItemId: itemId, taskName: task.name, index: 0, totalFiles: 1,
        })
      }
      return exportPreviewImage({
        exportDir, fileName: filename, width: res.width, height: res.height,
        layers: exportLayers, format, quality: 100,
        exportTaskId: task.id, exportItemId: itemId,
      })
    },
  }), [exportOptions, displayUrl, isLivePhoto, url, liveVideoUrl, buildAdjustedLayers])

  if (!displayUrl && layers.length === 0) return null

  return (
    <div
      ref={stageRef}
      className="preview-stage"
      data-crop-active={cropActive ? '' : undefined}
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      {layers.length > 0 && (
        <div ref={wrapperRef} className="preview-canvas-wrapper">
          <LrcRender
            layers={layers}
            canvasWidth={previewCanvas?.width}
            canvasHeight={previewCanvas?.height}
            onRender={handleRender}
            onVideoElement={handleVideoElement}
          />
        </div>
      )}
      {renderOverlay?.()}
      {loading && (
        <div className="preview-loading-overlay">
          <div className="preview-loading-spinner" />
        </div>
      )}
      {isLivePhoto && (
        <LivePhotoBadge
          size={32}
          onClick={toggleLivePhoto}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLivePhoto() } }}
          aria-label={livePlaying ? '停止 Live 图播放' : '播放 Live 图'}
          style={{
            position: 'absolute',
            left: 18,
            bottom: 18,
            cursor: liveVideoLoading || !liveVideoUrl ? 'wait' : 'pointer',
            opacity: liveVideoLoading || !liveVideoUrl ? 0.72 : 1,
          }}
        />
      )}
      {isDisplayVideo && !livePlaying && videoRef.current && (
        <div className="preview-video-controls">
          <button className="preview-video-btn" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <input
            className="preview-video-progress"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="进度"
          />
          <span className="preview-video-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
      )}
    </div>
  )
})

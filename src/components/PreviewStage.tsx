import { useState, useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { Play, Pause } from 'lucide-react'
import { LrcRender } from './LrcRender'
import { exportPreviewImage, exportPreviewLivePhoto, exportPreviewVideo } from './previewStageExport'
import type { PreviewLayer } from '../shared/types'
import { useIsLivePhoto } from '../shared/livePhoto'
import { LivePhotoBadge } from '../ui'
import { baseNameFromPath, isImagePath, isVideoPath } from '../lib/fileUtils'
import type { EditPipeline } from '../workspace/shared/editPipeline'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../workspace/shared/renderLayerPipeline'
import './PreviewStage.css'

/** 缩放模式 */
export type ScaleMode = 'fill' | 'contain'

interface PreviewStageProps {
  url: string | null
  pending?: boolean
  /** 缩放模式，默认 contain */
  scaleMode?: ScaleMode
  /** 叠加层（水印、贴纸等） */
  extraLayers?: PreviewLayer[]
  /** 导出选项（启用后可通过 ref.export() 导出当前帧） */
  exportOptions?: ExportOptions
  /** 编辑工作台管线。传入后会写入主媒体 layer，由 Rust/wgpu 统一处理。 */
  pipeline?: EditPipeline
  /** 裁剪编辑态：预览画面缩小留出操作边距，底图仍由传入 pipeline 决定。 */
  cropActive?: boolean
  /** 预览几何信息变化，用于裁切 UI 等编辑控件。 */
  onMetricsChange?: (metrics: { imageRect: { x: number; y: number; width: number; height: number }; sourceAspect: number }) => void
  onMediaSize?: (width: number, height: number) => void
  renderOverlay?: () => ReactNode
}

export interface MediaResolution {
  width: number
  height: number
}

/** 导出选项 */
export interface ExportOptions {
  /** 是否启用导出功能 */
  enable: boolean
  /** 图片格式，默认 jpeg */
  format?: 'jpeg' | 'png' | 'webp'
  /** 图片质量（仅 jpeg/webp 有效），0-1，默认 1.0 */
  quality?: number
}

/** PreviewStage 暴露给父组件的方法 */
export interface PreviewStageHandle {
  /** 导出当前预览帧为图片文件 */
  export(): Promise<{ path: string; name: string }>
}

interface StageSize {
  width: number
  height: number
}

interface RenderState {
  layers: PreviewLayer[]
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

/**
 * 根据媒体 URL 和缩放模式生成 PreviewLayer[]
 * @param stageSize - Project Canvas 尺寸（非 UI Stage 尺寸）
 */
export function buildLayers(
  url: string,
  scaleMode: ScaleMode = 'contain',
  resolution: MediaResolution | null = null,
  stageSize: StageSize | null = null,
): PreviewLayer[] {
  const hasMeasuredFrame = scaleMode === 'contain' && isValidSize(resolution) && isValidSize(stageSize)
  const frame = hasMeasuredFrame
    ? containFrame(resolution, stageSize)
    : { dstX: 0, dstY: 0, dstW: 1, dstH: 1 }
  const fit: ScaleMode = scaleMode
  if (hasMeasuredFrame) {
    console.log(`[PreviewStage] buildLayers resolution=${resolution!.width}x${resolution!.height} stage=${stageSize!.width}x${stageSize!.height} frame=${JSON.stringify(frame)} fit=${fit}`)
  }

  const baseLayer = { ...frame, fit, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }

  if (isImagePath(url)) {
    return [{ ...baseLayer, filePath: url }]
  }
  if (isVideoPath(url)) {
    return [{ ...baseLayer, filePath: url, isVideo: true }]
  }
  return []
}

/**
 * 计算宽高比（保留两位小数）
 */
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
  { url, pending = false, scaleMode = 'contain', extraLayers, exportOptions, pipeline, cropActive, onMetricsChange, onMediaSize, renderOverlay },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const lastStageDebugRef = useRef('')
  const [stageSize, setStageSize] = useState<StageSize | null>(null)
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
  const [renderState, setRenderState] = useState<RenderState | null>(null)
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

  // ── Project Canvas：统一布局画布，预览和导出共用同一比例 ──
  // 预览时渲染到 projectCanvas 尺寸，CSS 等比例显示在 Stage 容器内
  // 导出时渲染到原始分辨率（比例一致，结果相同）
  const projectCanvas = useMemo(() => {
    return projectCanvasFor(resolution)
  }, [resolution])

  // 监听舞台尺寸，按当前视口比例构建 layer，避免资源被拉伸。
  useEffect(() => {
    const element = stageRef.current
    if (!element) {
      setStageSize(null)
      return
    }

    const updateStageSize = () => {
      const { clientWidth, clientHeight } = element
      if (clientWidth <= 0 || clientHeight <= 0) return
      const debugKey = `${clientWidth}x${clientHeight}|display=${displayUrl}|layout=${layoutUrl}`
      if (debugKey !== lastStageDebugRef.current) {
        lastStageDebugRef.current = debugKey
        console.log('[PreviewStage:stageSize]', {
          stage: `${clientWidth}x${clientHeight}`,
          displayUrl,
          layoutUrl,
          livePlaying,
        })
      }
      setStageSize((current) => (
        current?.width === clientWidth && current?.height === clientHeight
          ? current
          : { width: clientWidth, height: clientHeight }
      ))
    }

    updateStageSize()
    const resizeObserver = new ResizeObserver(updateStageSize)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [displayUrl, layoutUrl, livePlaying])

  const buildAdjustedLayers = useCallback((sourceUrl: string | null, layerResolution = resolution, forceBaseFit?: ScaleMode): PreviewLayer[] => {
    // 基于 Project Canvas 计算布局，Stage 不参与
    const canvas = projectCanvasFor(layerResolution) ?? { width: 1440, height: 1440 }
    const main = sourceUrl ? buildLayers(sourceUrl, scaleMode, layerResolution, canvas) : []
    if (forceBaseFit && main[0]) main[0] = { ...main[0], fit: forceBaseFit }
    if (main[0] && pipeline) {
      main[0] = {
        ...main[0],
        color: pipelineColorToRenderColor(pipeline.color),
        transform: pipelineTransformToRenderTransform(pipeline.transform),
      }
    }
    if (!extraLayers?.length) return main

    const m = main[0]
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
    return [...main, ...adjusted]
  }, [scaleMode, resolution, extraLayers, pipeline])

  const layers = useMemo(() => {
    if (pending || !resolution) return []
    return buildAdjustedLayers(displayUrl, resolution, livePlaying ? 'fill' : undefined)
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
        console.log(`[PreviewStage] getMediaResolution: ${layoutUrl} -> ${res.width}x${res.height}`)
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
    if (layers.length === 0) return
    setRenderState({ layers })
  }, [layers])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !projectCanvas || !stageSize) return
    const rect = wrapper.getBoundingClientRect()
    console.log('[PreviewStage:wrapper]', {
      stage: `${stageSize.width}x${stageSize.height}`,
      projectCanvas: `${projectCanvas.width}x${projectCanvas.height}`,
      wrapperRect: `${rect.width.toFixed(2)}x${rect.height.toFixed(2)}`,
      displayUrl,
      layoutUrl,
      livePlaying,
    })
  }, [projectCanvas, stageSize, displayUrl, layoutUrl, livePlaying])

  useEffect(() => {
    const stage = stageRef.current
    const wrapper = wrapperRef.current
    const mainLayer = renderState?.layers[0]
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
  }, [onMetricsChange, renderState, resolution])

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

      // 创建导出任务记录
      const itemId = `preview_${baseName}_${Date.now()}`
      const task = await window.luna.exportTask.create('单帧导出', [
        { id: itemId, sourcePath: displayUrl, outputPath },
      ])

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
          videoLayers: buildAdjustedLayers(exportLiveVideoUrl, liveResolution, 'fill'),
          appleLivePhoto: Boolean(settings.exportAppleLivePhoto),
        })
      }

      if (exportingVideo) {
        return exportPreviewVideo({
          exportDir, fileName: filename, width: res.width, height: res.height,
          layers: exportLayers, qualityPreset: 'high',
          exportTaskId: task.id, exportItemId: itemId,
        })
      }
      return exportPreviewImage({
        exportDir, fileName: filename, width: res.width, height: res.height,
        layers: exportLayers, format, quality: 100,
        exportTaskId: task.id, exportItemId: itemId,
      })
    },
  }), [exportOptions, displayUrl, isLivePhoto, url, liveVideoUrl, buildAdjustedLayers])

  if (!displayUrl && !renderState) return null

  return (
    <div
      ref={stageRef}
      className="preview-stage"
      data-crop-active={cropActive ? '' : undefined}
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      {renderState && (
        <div ref={wrapperRef} className="preview-canvas-wrapper">
          <LrcRender layers={renderState.layers} onRender={handleRender} onVideoElement={handleVideoElement} onMediaSize={onMediaSize} />
        </div>
      )}
      {renderOverlay?.()}
      {loading && (
        <div className="preview-loading-overlay">
          <div className="preview-loading-spinner" />
        </div>
      )}
      {isLivePhoto && (
        <button
          type="button"
          disabled={liveVideoLoading || !liveVideoUrl}
          onClick={toggleLivePhoto}
          aria-label={livePlaying ? '停止 Live 图播放' : '播放 Live 图'}
          style={{
            position: 'absolute',
            left: 18,
            bottom: 18,
            display: 'grid',
            width: 44,
            height: 44,
            placeItems: 'center',
            border: 0,
            borderRadius: '50%',
            background: livePlaying ? 'rgba(0, 102, 204, 0.78)' : 'rgba(255, 255, 255, 0.16)',
            color: '#fff',
            cursor: liveVideoLoading || !liveVideoUrl ? 'wait' : 'pointer',
            opacity: liveVideoLoading || !liveVideoUrl ? 0.72 : 1,
          }}
        >
          <LivePhotoBadge size={32} />
        </button>
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

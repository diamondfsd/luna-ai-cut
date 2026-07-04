import { useState, useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Play, Pause } from 'lucide-react'
import { LrcRender } from './LrcRender'
import type { LrcRenderHandle } from './LrcRender'
import type { PreviewLayer } from '../shared/types'
import './PreviewStage.css'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v']

function getExtension(url: string): string {
  const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function isImage(url: string): boolean {
  return IMAGE_EXTENSIONS.includes(getExtension(url))
}

function isVideo(url: string): boolean {
  return VIDEO_EXTENSIONS.includes(getExtension(url))
}

/** 缩放模式 */
export type ScaleMode = 'fill' | 'contain'

interface PreviewStageProps {
  url: string | null
  /** 缩放模式，默认 contain */
  scaleMode?: ScaleMode
  /** 叠加层（水印、贴纸等） */
  extraLayers?: PreviewLayer[]
  /** 导出选项（启用后可通过 ref.export() 导出当前帧） */
  exportOptions?: ExportOptions
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
  /** 图片质量（仅 jpeg/webp 有效），0-1，默认 0.95 */
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
 * 统一构建层数据 — 根据媒体 URL 和缩放模式生成 PreviewLayer[]
 */
export function buildLayers(
  url: string,
  scaleMode: ScaleMode,
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

  if (isImage(url)) {
    return [{ ...baseLayer, filePath: url }]
  }
  if (isVideo(url)) {
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

export const PreviewStage = forwardRef<PreviewStageHandle, PreviewStageProps>(function PreviewStage(
  { url, scaleMode = 'contain', extraLayers, exportOptions },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const lrcRef = useRef<LrcRenderHandle | null>(null)
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
  const isVideoUrl = url ? isVideo(url) : false

  // 暴露 video 元素并绑定事件
  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    if (videoRef.current === el) return
    // 解绑旧元素
    if (videoRef.current) {
      videoRef.current.onplay = null
      videoRef.current.onpause = null
      videoRef.current.ontimeupdate = null
      videoRef.current.onloadedmetadata = null
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
    } else {
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
  }, [])

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

  function formatTime(t: number): string {
    if (!Number.isFinite(t) || t < 0) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // url 变化时显示 loading，onRender 时取消
  useEffect(() => {
    if (!url) { setLoading(false); return }
    if (url !== prevUrlRef.current) {
      prevUrlRef.current = url
      setLoading(true)
    }
  }, [url])

  function handleRender() {
    setLoading(false)
  }

  // 宽高比（由 resolution 派生）
  const aspectRatio = useMemo(() => {
    if (!resolution) return null
    return calcAspectRatio(resolution.width, resolution.height)
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
  }, [url])

  const layers = useMemo(() => {
    const main = url ? buildLayers(url, scaleMode, resolution, stageSize) : []
    if (!extraLayers?.length) return main

    // 叠加层的坐标相对于主图内容区（解决 contain 黑边导致水印跑出画面）
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
  }, [url, scaleMode, resolution, stageSize, extraLayers])

  // 通过 IPC 获取媒体文件实际分辨率
  useEffect(() => {
    if (!url) {
      setResolution(null)
      return
    }
    window.luna.workspace.getMediaResolution(url)
      .then((res) => {
        console.log(`[PreviewStage] getMediaResolution: ${url} -> ${res.width}x${res.height}`)
        setResolution(res)
      })
      .catch(() => setResolution(null))
  }, [url])

  // 暴露导出方法
  useImperativeHandle(ref, () => ({
    async export() {
      if (!exportOptions?.enable) throw new Error('导出未启用')

      // 获取原始分辨率
      const res = resolution
      if (!res) throw new Error('媒体分辨率未就绪')

      // 从设置中获取导出目录
      const settings = await window.luna.getSettings()
      const exportDir = settings.exportDir
      if (!exportDir) throw new Error('导出目录未配置')

      // 从 URL 提取文件名
      const urlParts = url!.split('/')
      const lastPart = urlParts[urlParts.length - 1] || 'export'
      const dotIndex = lastPart.lastIndexOf('.')
      const baseName = dotIndex > 0 ? lastPart.substring(0, dotIndex) : lastPart
      const format = exportOptions.format || 'jpeg'
      const quality = exportOptions.quality ?? 0.95
      const filename = `${baseName}.${format}`

      // 构造输出路径（统一用 /，Node.js 跨平台兼容）
      const outputPath = exportDir.endsWith('/') ? `${exportDir}${filename}` : `${exportDir}/${filename}`

      // 通过 LrcRender 的 Rust 渲染管线直接导出
      const lrcHandle = lrcRef.current
      if (!lrcHandle) throw new Error('LrcRender 未就绪')
      await lrcHandle.exportImage(outputPath, res.width, res.height, format, quality)

      return { path: outputPath, name: filename }
    },
  }), [exportOptions, resolution, url])

  if (!url || layers.length === 0) return null

  return (
    <div
      ref={stageRef}
      className="preview-stage"
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      <LrcRender ref={lrcRef} layers={layers} onRender={handleRender} onVideoElement={handleVideoElement} />
      {loading && (
        <div className="preview-loading-overlay">
          <div className="preview-loading-spinner" />
        </div>
      )}
      {isVideoUrl && videoRef.current && (
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

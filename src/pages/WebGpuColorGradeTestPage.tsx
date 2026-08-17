import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  Film,
  Gauge,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Upload,
  X,
  Zap,
} from 'lucide-react'

import { Button, IconButton, Slider } from '../ui'
import {
  DEFAULT_COLOR_GRADE,
  WebGpuColorRenderer,
  type ColorGradeAdjustments,
} from '../lib/webgpu-color-grade'
import {
  exportColorGradedVideo,
  type WebGpuVideoExportProgress,
} from '../lib/webgpu-color-export'
import '../styles/webgpu-color-grade-test.css'

type MediaKind = 'image' | 'video'

interface MediaSourceState {
  id: number
  kind: MediaKind
  file: File
  url: string
  name: string
  width: number
  height: number
  duration: number | null
}

interface PreviewMetrics {
  fps: number
  renderMs: number
  averageMs: number
  frames: number
}

type GpuStatus =
  | { state: 'loading'; message: string }
  | { state: 'ready'; message: string }
  | { state: 'error'; message: string }

const ADJUSTMENT_FIELDS: Array<{
  key: keyof ColorGradeAdjustments
  label: string
  min: number
  max: number
  step: number
}> = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.1 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
]

export function WebGpuColorGradeTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const rendererRef = useRef<WebGpuColorRenderer | null>(null)
  const adjustmentsRef = useRef<ColorGradeAdjustments>(DEFAULT_COLOR_GRADE)
  const exportAbortRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const [renderer, setRenderer] = useState<WebGpuColorRenderer | null>(null)
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>({ state: 'loading', message: '正在初始化 WebGPU' })
  const [source, setSource] = useState<MediaSourceState | null>(null)
  const [adjustments, setAdjustments] = useState<ColorGradeAdjustments>(DEFAULT_COLOR_GRADE)
  const [metrics, setMetrics] = useState<PreviewMetrics>({ fps: 0, renderMs: 0, averageMs: 0, frames: 0 })
  const [isPlaying, setIsPlaying] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<WebGpuVideoExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const nextRenderer = new WebGpuColorRenderer(canvasRef.current)
    rendererRef.current = nextRenderer
    let disposed = false

    void nextRenderer.initialize((message) => {
      if (!disposed) setGpuStatus({ state: 'error', message })
    }).then(() => {
      if (!disposed) {
        setRenderer(nextRenderer)
        setGpuStatus({ state: 'ready', message: 'WebGPU 已就绪' })
      }
    }).catch((reason: unknown) => {
      if (!disposed) {
        setGpuStatus({ state: 'error', message: reason instanceof Error ? reason.message : String(reason) })
      }
    })

    return () => {
      disposed = true
      nextRenderer.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    adjustmentsRef.current = adjustments
  }, [adjustments])

  useEffect(() => {
    const activeRenderer = renderer
    if (!activeRenderer || !source || isExporting) return

    let cancelled = false
    let animationFrame = 0
    let windowStart = performance.now()
    let windowFrames = 0
    let totalFrames = 0
    let totalRenderMs = 0
    const activeVideo = videoRef.current

    const tick = (now: number) => {
      if (cancelled) return
      const media = source.kind === 'image' ? imageRef.current : activeVideo
      const hasVideoFrame = source.kind !== 'video' || (activeVideo?.readyState ?? 0) >= HTMLMediaElement.HAVE_CURRENT_DATA
      if (media && hasVideoFrame) {
        try {
          const renderStats = activeRenderer.render(media, adjustmentsRef.current)
          windowFrames += 1
          totalFrames += 1
          totalRenderMs += renderStats.submitMs
          if (now - windowStart >= 500) {
            setMetrics({
              fps: (windowFrames * 1000) / (now - windowStart),
              renderMs: renderStats.submitMs,
              averageMs: totalRenderMs / totalFrames,
              frames: totalFrames,
            })
            windowStart = now
            windowFrames = 0
          }
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : String(reason))
          cancelled = true
          return
        }
      }
      animationFrame = requestAnimationFrame(tick)
    }

    if (source.kind === 'video' && isPlaying) void activeVideo?.play().catch(() => undefined)
    animationFrame = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      if (source.kind === 'video') activeVideo?.pause()
    }
  }, [renderer, source, isExporting, isPlaying])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    exportAbortRef.current?.abort()
  }, [])

  const chooseMedia = useCallback(async (file: File) => {
    setError(null)
    setExportProgress(null)
    setMetrics({ fps: 0, renderMs: 0, averageMs: 0, frames: 0 })
    exportAbortRef.current?.abort()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const id = Date.now()
    try {
      if (file.type.startsWith('image/')) {
        const image = new Image()
        image.src = url
        await image.decode()
        imageRef.current = image
        setSource({ id, kind: 'image', file, url, name: file.name, width: image.naturalWidth, height: image.naturalHeight, duration: null })
        return
      }

      if (file.type.startsWith('video/')) {
        const video = videoRef.current
        if (!video) throw new Error('视频预览元素尚未准备好')
        video.pause()
        video.src = url
        video.load()
        await waitForVideoMetadata(video)
        setIsPlaying(true)
        setSource({ id, kind: 'video', file, url, name: file.name, width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : null })
        return
      }

      throw new Error('请选择图片或视频文件')
    } catch (reason: unknown) {
      URL.revokeObjectURL(url)
      objectUrlRef.current = null
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  const updateAdjustment = (key: keyof ColorGradeAdjustments, value: number) => {
    setAdjustments((current) => ({ ...current, [key]: value }))
  }

  const resetAdjustments = () => setAdjustments({ ...DEFAULT_COLOR_GRADE })

  const togglePlayback = () => {
    if (!source || source.kind !== 'video' || !videoRef.current) return
    if (videoRef.current.paused) {
      setIsPlaying(true)
      void videoRef.current.play().catch(() => undefined)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const exportImage = async () => {
    if (!renderer || !source || source.kind !== 'image' || !imageRef.current) return
    setError(null)
    try {
      renderer.render(imageRef.current, adjustmentsRef.current)
      const blob = await renderer.toPngBlob()
      downloadBlob(blob, `${stripExtension(source.name)}-webgpu-grade.png`)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const exportVideo = async () => {
    if (!renderer || !source || source.kind !== 'video') return
    const controller = new AbortController()
    exportAbortRef.current = controller
    setIsExporting(true)
    setError(null)
    setExportProgress({ phase: 'preparing', progress: 0, currentFrame: 0, totalFrames: 0, message: '准备导出' })
    try {
      const result = await exportColorGradedVideo({
        file: source.file,
        renderer,
        adjustments: adjustmentsRef.current,
        signal: controller.signal,
        onProgress: setExportProgress,
      })
      downloadBlob(result.blob, result.filename)
    } catch (reason: unknown) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      exportAbortRef.current = null
      setIsExporting(false)
    }
  }

  const cancelExport = () => exportAbortRef.current?.abort()
  const statusClass = gpuStatus.state === 'ready' ? 'is-ready' : gpuStatus.state === 'error' ? 'is-error' : 'is-loading'

  return (
    <main className="webgpu-grade-page">
      <header className="webgpu-grade-header">
        <div>
          <p className="webgpu-grade-eyebrow">Developer performance lab</p>
          <h1>WebGPU 调色测试</h1>
          <p className="webgpu-grade-subtitle">同一条 GPU 调色链路覆盖图片、视频预览与文件导出。</p>
        </div>
        <div className={`webgpu-grade-status ${statusClass}`}>
          <span className="webgpu-grade-status-dot" />
          <span>{gpuStatus.message}</span>
        </div>
      </header>

      <section className="webgpu-grade-toolbar" aria-label="媒体选择和导出">
        <input
          ref={fileInputRef}
          className="webgpu-grade-file-input"
          type="file"
          accept="image/*,video/*"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void chooseMedia(file)
          }}
        />
        <Button variant="primary" icon={<Upload size={16} />} disabled={gpuStatus.state !== 'ready' || isExporting} onClick={() => fileInputRef.current?.click()}>
          选择图片或视频
        </Button>
        {source?.kind === 'video' && (
          <Button variant="secondary" icon={isPlaying ? <Pause size={16} /> : <Play size={16} />} disabled={isExporting} onClick={togglePlayback}>
            {isPlaying ? '暂停预览' : '播放预览'}
          </Button>
        )}
        <div className="webgpu-grade-toolbar-spacer" />
        <Button variant="secondary" icon={<ImageIcon size={16} />} disabled={!source || source.kind !== 'image' || isExporting} onClick={() => void exportImage()}>
          导出 PNG
        </Button>
        <Button variant="primary" icon={<Film size={16} />} disabled={!source || source.kind !== 'video' || isExporting} onClick={() => void exportVideo()}>
          导出视频
        </Button>
        {isExporting && <Button variant="danger" size="compact" icon={<X size={15} />} onClick={cancelExport}>取消导出</Button>}
      </section>

      <div className="webgpu-grade-layout">
        <section className="webgpu-grade-preview-panel">
          <div className="webgpu-grade-panel-heading">
            <div>
              <span className="webgpu-grade-panel-kicker">Preview</span>
              <h2>{source?.name ?? '等待媒体'}</h2>
            </div>
            {source && <span className="webgpu-grade-resolution">{source.width} × {source.height}{source.duration ? ` · ${formatDuration(source.duration)}` : ''}</span>}
          </div>
          <div className="webgpu-grade-canvas-wrap">
            {!source && (
              <Button className="webgpu-grade-empty" variant="ghost" icon={<Upload size={28} />} onClick={() => fileInputRef.current?.click()}>
                <span>选择一张图片或一段视频开始测试</span>
              </Button>
            )}
            <canvas ref={canvasRef} className={`webgpu-grade-canvas${source ? ' has-media' : ''}`} aria-label="WebGPU 调色预览" />
            <video ref={videoRef} className="webgpu-grade-source-video" muted playsInline preload="auto" aria-hidden="true" />
          </div>
          <div className="webgpu-grade-metrics" aria-label="性能指标">
            <Metric icon={<Gauge size={15} />} label="FPS" value={metrics.fps ? metrics.fps.toFixed(1) : '0.0'} />
            <Metric icon={<Zap size={15} />} label="提交耗时" value={`${metrics.renderMs.toFixed(2)} ms`} />
            <Metric icon={<Zap size={15} />} label="平均耗时" value={`${metrics.averageMs.toFixed(2)} ms`} />
            <Metric icon={<Film size={15} />} label="已渲染帧" value={metrics.frames.toLocaleString()} />
          </div>
        </section>

        <aside className="webgpu-grade-controls-panel">
          <div className="webgpu-grade-panel-heading">
            <div>
              <span className="webgpu-grade-panel-kicker">Color controls</span>
              <h2>调色参数</h2>
            </div>
            <IconButton variant="outline" size="compact" icon={<RotateCcw size={15} />} aria-label="重置调色参数" title="重置调色参数" onClick={resetAdjustments} />
          </div>
          <div className="webgpu-grade-sliders">
            {ADJUSTMENT_FIELDS.map((field) => (
              <div className="webgpu-grade-slider-row" key={field.key}>
                <div className="webgpu-grade-slider-label">
                  <span>{field.label}</span>
                  <output>{formatAdjustmentValue(adjustments[field.key], field.step)}</output>
                </div>
                <Slider
                  value={adjustments[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  ariaLabel={field.label}
                  disabled={gpuStatus.state !== 'ready'}
                  onValueChange={(value) => updateAdjustment(field.key, value)}
                />
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className="webgpu-grade-info-grid">
        <InfoItem icon={<Zap size={16} />} label="渲染路径" value="媒体 → WebGPU shader → 画布" />
        <InfoItem icon={<Film size={16} />} label="视频路径" value="WebGPU / H.264 / MP4" />
        <InfoItem icon={<ImageIcon size={16} />} label="当前输入" value={source ? `${source.kind === 'image' ? '图片' : '视频'} · ${formatBytes(source.file.size)}` : '未选择'} />
        <InfoItem icon={<CheckCircle2 size={16} />} label="设备状态" value={gpuStatus.state === 'ready' ? 'GPU 加速可用' : gpuStatus.message} />
      </section>

      {exportProgress && (
        <section className="webgpu-grade-export-status" aria-live="polite">
          <div className="webgpu-grade-export-heading">
            <div>
              <span className="webgpu-grade-panel-kicker">Export</span>
              <h2>{exportProgress.message}</h2>
            </div>
            <strong>{exportProgress.progress}%</strong>
          </div>
          <div className="webgpu-grade-progress-track"><span style={{ width: `${exportProgress.progress}%` }} /></div>
          <div className="webgpu-grade-export-meta">
            <span>{exportProgress.phase}</span>
            <span>{exportProgress.totalFrames ? `${exportProgress.currentFrame.toLocaleString()} / ${exportProgress.totalFrames.toLocaleString()} 帧` : '准备中'}</span>
          </div>
        </section>
      )}

      {error && <div className="webgpu-grade-error" role="alert">{error}</div>}
    </main>
  )
}

function Metric(props: { icon: ReactNode; label: string; value: string }) {
  return <div className="webgpu-grade-metric"><span className="webgpu-grade-metric-icon">{props.icon}</span><span className="webgpu-grade-metric-label">{props.label}</span><strong>{props.value}</strong></div>
}

function InfoItem(props: { icon: ReactNode; label: string; value: string }) {
  return <div className="webgpu-grade-info-item"><span className="webgpu-grade-info-icon">{props.icon}</span><div><span>{props.label}</span><strong>{props.value}</strong></div></div>
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频无法读取，请换一个浏览器支持的格式'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'media'
}

function formatAdjustmentValue(value: number, step: number): string {
  return step < 1 ? value.toFixed(1) : String(Math.round(value))
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

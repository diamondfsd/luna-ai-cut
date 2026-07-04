import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Pause, Play, RefreshCw, Upload } from 'lucide-react'
import { Button, Input, SegmentedControl, Switch } from '../ui'
import './WatermarkDemoPage.css'

// ── 类型 ──

type WatermarkType = 'text' | 'image'
type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

interface WatermarkConfig {
  enabled: boolean
  type: WatermarkType
  text: string
  fontSize: number
  color: string
  imageDataUrl: string | null
  widthRatio: number
  opacity: number
  position: WatermarkPosition
  marginRatio: number
}

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
}

declare global {
  interface Window {
    lunaRenderCore?: {
      init: (logPath?: string) => Promise<void>
      pickVideo: () => Promise<string | null>
      loadTexture: (data: Uint8Array, width: number, height: number) => Promise<number>
      updateTexture: (textureId: number, data: Uint8Array) => Promise<void>
      releaseTexture: (textureId: number) => Promise<void>
      renderFrame: (w: number, h: number, layers: RenderLayer[]) => Promise<Uint8Array>
      exportVideo: (inputPath: string, outputPath: string, canvasW: number, canvasH: number,
                    fps: number | null, hardware: boolean,
                    videoLayer: RenderLayer, overlayLayers: RenderLayer[]) => Promise<void>
      destroy: () => Promise<void>
    }
  }
}

const POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'center', label: '居中' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
]

const DEFAULT_CONFIG: WatermarkConfig = {
  enabled: true,
  type: 'text',
  text: 'Watermark',
  fontSize: 0.04,
  color: 'rgba(255, 255, 255, 0.85)',
  imageDataUrl: null,
  widthRatio: 0.2,
  opacity: 0.85,
  position: 'bottom-right',
  marginRatio: 0.03,
}

// ── 水印 dst rect 计算 ──
function calcWatermarkDst(
  config: WatermarkConfig,
  canvasW: number,
  canvasH: number,
  imgW?: number,
  imgH?: number,
): { x: number; y: number; w: number; h: number } {
  const margin = config.marginRatio
  let w: number, h: number
  if (config.type === 'image' && imgW && imgH) {
    const aspect = imgH / imgW
    w = config.widthRatio
    h = w * aspect * (canvasW / canvasH)
  } else {
    w = Math.max(config.text.length * config.fontSize * 0.6, 0.05)
    h = config.fontSize * 1.3
  }
  const [v, hPos] = config.position === 'center'
    ? ['center' as const, 'center' as const]
    : config.position.split('-') as [string, string]
  let x: number, y: number
  switch (hPos) { case 'left': x = margin; break; case 'center': x = (1 - w) / 2; break; case 'right': x = 1 - w - margin; break; default: x = margin }
  switch (v) { case 'top': y = margin; break; case 'center': y = (1 - h) / 2; break; case 'bottom': y = 1 - h - margin; break; default: y = 1 - h - margin }
  return { x: Math.max(0, x), y: Math.max(0, y), w, h: Math.max(0, h) }
}

// ── 主页面 ──

export function WatermarkDemoPage() {
  const [config, setConfig] = useState<WatermarkConfig>(DEFAULT_CONFIG)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null)
  const [videoFileName, setVideoFileName] = useState<string>('')
  const [vw, setVw] = useState(0)
  const [vh, setVh] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rCoreReady, setRCoreReady] = useState(false)
  const [renderedDataUrl, setRenderedDataUrl] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const wmTextureIdRef = useRef<number | null>(null)
  const frameTextureIdRef = useRef<number | null>(null)
  const wmImgRef = useRef<HTMLImageElement | null>(null)
  const configRef = useRef(config)
  const lastRenderRef = useRef(0)
  configRef.current = config

  // ── 初始化 Native Core ──
  useEffect(() => {
    const lrc = window.lunaRenderCore
    if (!lrc) { setError('Native render core 未加载'); return }
    lrc.init('luna-rc.log').then(() => setRCoreReady(true)).catch((e: Error) => setError(e.message))
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (wmTextureIdRef.current != null) lrc.releaseTexture(wmTextureIdRef.current).catch(() => {})
      if (frameTextureIdRef.current != null) lrc.releaseTexture(frameTextureIdRef.current).catch(() => {})
      lrc.destroy().catch(() => {})
    }
  }, [])

  // ── 选择视频（Electron 原生文件对话框，获取真实路径） ──
  const handleSelectVideo = useCallback(async () => {
    const lrc = window.lunaRenderCore
    if (!lrc?.pickVideo) {
      // 回退到 HTML file input
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'video/*'
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        setPlaying(false); setCurrentTime(0); setLoading(true); setError(null)
        const url = URL.createObjectURL(file)
        setVideoSrc(url); setVideoFilePath(url); setVideoFileName(file.name)
        const v = document.createElement('video')
        v.src = url; v.muted = true
        v.onloadedmetadata = () => { setVw(v.videoWidth); setVh(v.videoHeight); setDuration(v.duration); setLoading(false) }
      }
      input.click()
      return
    }
    // Electron native dialog
    const filePath = await lrc.pickVideo()
    if (!filePath) return
    setPlaying(false); setCurrentTime(0); setLoading(true); setError(null)
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    setVideoFilePath(filePath); setVideoFileName(fileName)
    // 用 file:// 协议加载视频
    const url = `file://${filePath}`
    setVideoSrc(url)
    const v = document.createElement('video')
    v.src = url; v.muted = true
    v.onloadedmetadata = () => { setVw(v.videoWidth); setVh(v.videoHeight); setDuration(v.duration); setLoading(false) }
  }, [])

  // ── 加载水印图片 ──
  const loadWatermarkImage = useCallback(async (dataUrl: string) => {
    const lrc = window.lunaRenderCore; if (!lrc) return null
    return new Promise<number | null>((resolve) => {
      const img = new Image()
      img.onload = async () => {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
        c.getContext('2d')!.drawImage(img, 0, 0)
        const idata = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
        try {
          const id = await lrc.loadTexture(new Uint8Array(idata.data.buffer), c.width, c.height)
          wmTextureIdRef.current = id; wmImgRef.current = img; resolve(id)
        } catch { resolve(null) }
      }; img.onerror = () => resolve(null); img.src = dataUrl
    })
  }, [])

  // ── 渲染一帧（核心） ──
  const renderOneFrame = useCallback(async (rgba: Uint8Array, fw: number, fh: number) => {
    const lrc = window.lunaRenderCore; if (!lrc) return
    try {
      // 更新视频帧纹理
      if (frameTextureIdRef.current != null) {
        await lrc.updateTexture(frameTextureIdRef.current, rgba)
      } else {
        frameTextureIdRef.current = await lrc.loadTexture(rgba, fw, fh)
      }
      const cfg = configRef.current
      const layers: RenderLayer[] = [
        { textureId: frameTextureIdRef.current, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 },
      ]
      if (cfg.enabled) {
        if (cfg.type === 'image' && wmTextureIdRef.current != null) {
          const dst = calcWatermarkDst(cfg, fw, fh, wmImgRef.current?.naturalWidth, wmImgRef.current?.naturalHeight)
          layers.push({ textureId: wmTextureIdRef.current, dstX: dst.x, dstY: dst.y, dstW: dst.w, dstH: dst.h, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: cfg.opacity, zIndex: 10 })
        } else if (cfg.type === 'text') {
          const textTexId = await renderTextToTexture(lrc, cfg, fw)
          if (textTexId != null) {
            const dst = calcWatermarkDst(cfg, fw, fh)
            layers.push({ textureId: textTexId, dstX: dst.x, dstY: dst.y, dstW: dst.w, dstH: dst.h, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: cfg.opacity, zIndex: 10 })
            // 异步释放文字纹理
            setTimeout(() => lrc.releaseTexture(textTexId).catch(() => {}), 200)
          }
        }
      }
      const result = await lrc.renderFrame(fw, fh, layers)
      // 显示到 canvas
      if (canvasRef.current) {
        const canvas = canvasRef.current; canvas.width = fw; canvas.height = fh
        const ctx = canvas.getContext('2d')!
        const idata = ctx.createImageData(canvas.width, canvas.height)
        idata.data.set(new Uint8Array(result.buffer, result.byteOffset, result.byteLength))
        ctx.putImageData(idata, 0, 0)
      }
    } catch (err) { console.error('renderOneFrame:', err) }
  }, [])

  const [previewQuality, setPreviewQuality] = useState(720)
  // 预览最大分辨率（避免 4K 视频逐帧 IPC 传输太慢）
  const getPreviewSize = useCallback((vw: number, vh: number) => {
    const max = previewQuality
    const longer = Math.max(vw, vh)
    if (longer <= max) return { w: vw, h: vh }
    const scale = max / longer
    return { w: Math.round(vw * scale), h: Math.round(vh * scale) }
  }, [previewQuality])

  // ── 抓取视频当前帧的 RGBA（缩放到预览分辨率） ──
  const grabVideoFrame = useCallback((): { rgba: Uint8Array; w: number; h: number } | null => {
    const v = videoRef.current; if (!v || v.readyState < 2) return null
    const preview = getPreviewSize(v.videoWidth, v.videoHeight)
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas')
    const c = offscreenRef.current
    if (c.width !== preview.w || c.height !== preview.h) {
      c.width = preview.w; c.height = preview.h
    }
    c.getContext('2d')!.drawImage(v, 0, 0, preview.w, preview.h)
    const idata = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { rgba: new Uint8Array(idata.data.buffer), w: c.width, h: c.height }
  }, [getPreviewSize])

  // ── 播放循环 ──
  const tickRef = useRef<() => void>(() => {})
  tickRef.current = () => {
    const v = videoRef.current; if (!v || v.paused) return
    setCurrentTime(v.currentTime)
    const frame = grabVideoFrame()
    if (frame) {
      renderOneFrame(frame.rgba, frame.w, frame.h)
      lastRenderRef.current = performance.now()
    }
    rafRef.current = requestAnimationFrame(() => tickRef.current())
  }

  const startPlayback = useCallback(() => {
    const v = videoRef.current; if (!v) return
    v.play(); setPlaying(true)
    rafRef.current = requestAnimationFrame(() => tickRef.current())
  }, [])

  const pausePlayback = useCallback(() => {
    const v = videoRef.current; if (!v) return
    v.pause(); setPlaying(false)
    cancelAnimationFrame(rafRef.current)
    // 暂停时渲染最后一帧
    const frame = grabVideoFrame()
    if (frame) { renderOneFrame(frame.rgba, frame.w, frame.h); lastRenderRef.current = performance.now() }
  }, [grabVideoFrame, renderOneFrame])

  // ── 进度条拖动 ──
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value)
    const v = videoRef.current; if (!v) return
    v.currentTime = t; setCurrentTime(t)
    v.onseeked = () => {
      const frame = grabVideoFrame()
      if (frame) { renderOneFrame(frame.rgba, frame.w, frame.h); lastRenderRef.current = performance.now() }
    }
  }, [grabVideoFrame, renderOneFrame])

  // ── 导出当前帧（PNG） ──
  const handleExportFrame = useCallback(() => {
    if (!canvasRef.current) return
    setRenderedDataUrl(canvasRef.current.toDataURL('image/png'))
  }, [])

  // ── 导出视频 ──
  const handleExportVideo = useCallback(async () => {
    const lrc = window.lunaRenderCore
    if (!lrc || !videoFilePath || vw === 0) return
    setExporting(true); setExportMsg('导出中...（请勿关闭窗口）')
    try {
      // 构建 layers：视频帧(textureId=0) + 水印
      const cfg = configRef.current
      const videoLayer: RenderLayer = { textureId: 0, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }
      const overlayLayers: RenderLayer[] = []
      if (cfg.enabled) {
        if (cfg.type === 'image' && wmTextureIdRef.current != null && wmImgRef.current) {
          const dst = calcWatermarkDst(cfg, vw, vh, wmImgRef.current.naturalWidth, wmImgRef.current.naturalHeight)
          overlayLayers.push({ textureId: wmTextureIdRef.current, dstX: dst.x, dstY: dst.y, dstW: dst.w, dstH: dst.h, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: cfg.opacity, zIndex: 10 })
        }
      }
      const outPath = videoFilePath.replace(/\.[^.]+$/, '_watermarked.mp4')
      await lrc.exportVideo(videoFilePath, outPath, vw, vh, null, true, videoLayer, overlayLayers)
      setExportMsg(`导出完成: ${outPath}`)
    } catch (err) {
      setExportMsg(`导出失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }, [videoFilePath, vw, vh])

  useEffect(() => {
    if (renderedDataUrl) {
      const link = document.createElement('a')
      link.download = (videoFileName || 'frame').replace(/\.[^.]+$/, '') + '_watermarked.png'
      link.href = renderedDataUrl
      link.click()
      setRenderedDataUrl(null)
    }
  }, [renderedDataUrl, videoFileName])

  // ── 配置变化时重新渲染（非播放状态） ──
  useEffect(() => {
    if (!playing && vw > 0 && rCoreReady) {
      const frame = grabVideoFrame()
      if (frame) renderOneFrame(frame.rgba, frame.w, frame.h)
    }
  }, [config, rCoreReady])

  // ── 水印类型变化时重新加载图片 ──
  useEffect(() => {
    if (config.type === 'image' && config.imageDataUrl) { loadWatermarkImage(config.imageDataUrl) }
  }, [config.type, config.imageDataUrl, loadWatermarkImage])

  const handleSelectWmImage = useCallback(() => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = () => setConfig((prev) => ({ ...prev, imageDataUrl: reader.result as string }))
      reader.readAsDataURL(file)
    }; input.click()
  }, [])

  const updateConfig = useCallback(<K extends keyof WatermarkConfig>(key: K, value: WatermarkConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ── format time ──
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="watermark-demo">
      {/* 左侧：预览 + 播放控件 */}
      <div className="wd-preview-area">
        <div className="wd-canvas-shell">
          {!videoSrc ? (
            <div className="wd-empty-state">
              <Upload size={48} strokeWidth={1} />
              <p>选择视频文件以开始</p>
              <Button variant="primary" icon={<Upload size={16} />} onClick={handleSelectVideo}>选择文件</Button>
            </div>
          ) : loading ? (
            <div className="wd-empty-state"><RefreshCw size={32} className="spin" /><p>加载中...</p></div>
          ) : (
            <>
              <canvas ref={canvasRef} className="wd-canvas" />
              {error && <div className="wd-error">{error}</div>}
              {/* 隐藏的 video 元素用于解码 */}
              <video ref={videoRef} src={videoSrc} muted style={{ display: 'none' }}
                onEnded={() => { setPlaying(false); cancelAnimationFrame(rafRef.current) }}
              />
            </>
          )}
        </div>

        {/* 播放控件 */}
        {videoSrc && vw > 0 && (
          <div className="wd-controls">
            <button className="wd-play-btn" onClick={playing ? pausePlayback : startPlayback}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className="wd-time">{fmt(currentTime)}</span>
            <input type="range" className="wd-seek" min={0} max={duration || 1} step={0.01}
              value={currentTime} onChange={handleSeek} />
            <span className="wd-time">{fmt(duration)}</span>
            <span className="wd-resolution">源 {vw}x{vh}</span>
            <SegmentedControl ariaLabel="预览质量"
              options={[
                { value: '360', label: '360p' },
                { value: '540', label: '540p' },
                { value: '720', label: '720p' },
                { value: '1080', label: '1080p' },
              ]}
              value={String(previewQuality)}
              onChange={(v) => setPreviewQuality(parseInt(v, 10))}
            />
          </div>
        )}

        {/* 底部操作 */}
        {videoSrc && (
          <div className="wd-file-info">
            <span className="wd-file-name">{videoFileName}</span>
            <Button variant="secondary" size="compact" icon={<Upload size={14} />} onClick={handleSelectVideo}>更换</Button>
            <Button variant="secondary" size="compact" icon={<Download size={14} />} onClick={handleExportFrame}>导出帧</Button>
            <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={exporting} onClick={handleExportVideo}>
              {exporting ? '导出中...' : '导出视频'}
            </Button>
          </div>
        )}
        {exportMsg && (
          <div className={`wd-export-msg${exporting ? '' : exportMsg.includes('失败') ? ' wd-export-err' : ' wd-export-ok'}`}>
            {exporting && <RefreshCw size={14} className="spin" />} {exportMsg}
          </div>
        )}
      </div>

      {/* 右侧：水印配置 */}
      <div className="wd-config-panel">
        <h3 className="wd-panel-title">水印设置</h3>
        <label className="wd-row">
          <span>启用水印</span>
          <Switch checked={config.enabled} onCheckedChange={(v) => updateConfig('enabled', v)} ariaLabel="启用水印" />
        </label>
        <div className="wd-divider" />
        <SegmentedControl ariaLabel="水印类型"
          options={[{ value: 'text', label: '文字' }, { value: 'image', label: '图片' }]}
          value={config.type} onChange={(v) => updateConfig('type', v as WatermarkType)} />
        <div className="wd-divider" />
        {config.type === 'text' ? (<>
          <label className="wd-row"><span>文字内容</span><Input variant="compact" value={config.text} onChange={(e) => updateConfig('text', (e.target as HTMLInputElement).value)} /></label>
          <label className="wd-row"><span>字号</span><input type="range" min="0.01" max="0.15" step="0.005" value={config.fontSize} onChange={(e) => updateConfig('fontSize', parseFloat(e.target.value))} /><span className="wd-val">{(config.fontSize * 100).toFixed(1)}%</span></label>
          <label className="wd-row"><span>颜色</span><input type="color" value="#ffffff" onChange={(e) => updateConfig('color', e.target.value)} className="wd-color-input" /></label>
        </>) : (<>
          <label className="wd-row"><span>水印图片</span><Button variant="secondary" size="compact" icon={<ImagePlus size={14} />} onClick={handleSelectWmImage}>{config.imageDataUrl ? '更换' : '选择'}</Button></label>
          {config.imageDataUrl && <div className="wd-wm-preview"><img src={config.imageDataUrl} alt="水印预览" /></div>}
          <label className="wd-row"><span>宽度</span><input type="range" min="0.05" max="0.5" step="0.01" value={config.widthRatio} onChange={(e) => updateConfig('widthRatio', parseFloat(e.target.value))} /><span className="wd-val">{(config.widthRatio * 100).toFixed(0)}%</span></label>
        </>)}
        <div className="wd-divider" />
        <label className="wd-row"><span>透明度</span><input type="range" min="0.1" max="1" step="0.05" value={config.opacity} onChange={(e) => updateConfig('opacity', parseFloat(e.target.value))} /><span className="wd-val">{(config.opacity * 100).toFixed(0)}%</span></label>
        <div className="wd-divider" />
        <label className="wd-label">位置</label>
        <div className="wd-position-grid">
          {POSITIONS.map((pos) => (
            <button key={pos.value} className={`wd-pos-btn${config.position === pos.value ? ' active' : ''}`}
              onClick={() => updateConfig('position', pos.value)}>{pos.label}</button>
          ))}
        </div>
        <div className="wd-divider" />
        <label className="wd-row"><span>边距</span><input type="range" min="0" max="0.15" step="0.005" value={config.marginRatio} onChange={(e) => updateConfig('marginRatio', parseFloat(e.target.value))} /><span className="wd-val">{(config.marginRatio * 100).toFixed(1)}%</span></label>
      </div>
    </div>
  )
}

// ── 辅助：文字渲染到纹理 ──

async function renderTextToTexture(
  lrc: NonNullable<typeof window.lunaRenderCore>,
  cfg: WatermarkConfig,
  canvasW: number,
): Promise<number | null> {
  const fontSize = Math.round(cfg.fontSize * canvasW)
  const c = document.createElement('canvas'); const ctx = c.getContext('2d')!
  ctx.font = `${fontSize}px Arial, sans-serif`
  const m = ctx.measureText(cfg.text)
  c.width = Math.ceil(m.width) + 10; c.height = Math.ceil(fontSize * 1.4) + 4
  ctx.font = `${fontSize}px Arial, sans-serif`; ctx.fillStyle = cfg.color; ctx.textBaseline = 'top'
  ctx.fillText(cfg.text, 5, 2)
  const idata = ctx.getImageData(0, 0, c.width, c.height)
  try { return await lrc.loadTexture(new Uint8Array(idata.data.buffer), c.width, c.height) }
  catch { return null }
}

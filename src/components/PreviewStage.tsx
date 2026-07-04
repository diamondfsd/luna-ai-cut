import { useEffect, useRef, useState } from 'react'
import './PreviewStage.css'

interface RenderLayer {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number
  zIndex: number
}

function getLRC() {
  return (window as any).lunaRenderCore as {
    init: () => Promise<void>
    loadTexture: (data: Uint8Array, w: number, h: number) => Promise<number>
    updateTexture: (id: number, data: Uint8Array) => Promise<void>
    releaseTexture: (id: number) => Promise<void>
    renderFrame: (w: number, h: number, layers: RenderLayer[]) => Promise<Uint8Array>
    destroy: () => Promise<void>
  } | undefined
}

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

interface PreviewStageProps {
  url: string | null
}

export function PreviewStage({ url }: PreviewStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaTexRef = useRef<number | null>(null)
  const loadedUrlRef = useRef('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)

  const [lrcReady, setLrcReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // ── 初始化 lunaRenderCore ──
  useEffect(() => {
    const lrc = getLRC()
    if (!lrc) {
      setFatalError('lunaRenderCore 未加载')
      return
    }
    lrc.init()
      .then(() => setLrcReady(true))
      .catch((e: Error) => setFatalError(`渲染引擎初始化失败: ${e.message}`))

    return () => {
      cancelAnimationFrame(rafRef.current)
      if (mediaTexRef.current != null) {
        lrc.releaseTexture(mediaTexRef.current).catch(() => {})
        mediaTexRef.current = null
      }
      lrc.destroy().catch(() => {})
    }
  }, [])

  // ── 渲染一帧到 Canvas ──
  async function renderFrame(naturalW: number, naturalH: number) {
    const lrc = getLRC()
    const cvs = canvasRef.current
    if (!lrc || !cvs || mediaTexRef.current == null) return

    const pw = cvs.parentElement?.clientWidth ?? 400
    const ph = cvs.parentElement?.clientHeight ?? 300
    if (pw <= 0 || ph <= 0) return

    const ar = naturalW / (naturalH || 1)
    let dw = pw, dh = pw / ar
    if (dh > ph) { dh = ph; dw = ph * ar }
    const dx = (pw - dw) / 2
    const dy = (ph - dh) / 2

    try {
      const result = await lrc.renderFrame(pw, ph, [
        {
          textureId: mediaTexRef.current,
          dstX: dx / pw, dstY: dy / ph,
          dstW: dw / pw, dstH: dh / ph,
          srcX: 0, srcY: 0, srcW: 1, srcH: 1,
          opacity: 1, zIndex: 0,
        },
      ])
      cvs.width = pw
      cvs.height = ph
      cvs.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(result), pw, ph),
        0, 0,
      )
    } catch {
      // 静默忽略渲染错误
    }
  }

  // ── 上传 RGBA 数据到纹理并渲染 ──
  async function uploadTexture(rgba: Uint8Array, w: number, h: number) {
    const lrc = getLRC()
    if (!lrc) return

    if (mediaTexRef.current != null) {
      await lrc.updateTexture(mediaTexRef.current, rgba)
    } else {
      mediaTexRef.current = await lrc.loadTexture(rgba, w, h)
    }
    await renderFrame(w, h)
  }

  // ── 加载并渲染媒体 ──
  useEffect(() => {
    if (!lrcReady || !url || url === loadedUrlRef.current) return
    loadedUrlRef.current = url

    // 图片
    if (isImage(url)) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const c = document.createElement('canvas')
        c.width = iw; c.height = ih
        c.getContext('2d')!.drawImage(img, 0, 0, iw, ih)
        const idata = c.getContext('2d')!.getImageData(0, 0, iw, ih)
        uploadTexture(new Uint8Array(idata.data.buffer), iw, ih)
      }
      img.src = url
      return
    }

    // 视频
    if (isVideo(url)) {
      if (!videoRef.current) {
        videoRef.current = document.createElement('video')
        videoRef.current.muted = true
        videoRef.current.loop = true
        videoRef.current.playsInline = true
      }
      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas')
      }

      const video = videoRef.current
      video.src = url
      video.load()

      video.oncanplay = () => {
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (vw <= 0 || vh <= 0) return

        const oc = offscreenRef.current!
        oc.width = vw; oc.height = vh

        // 首帧立即渲染
        const frame = oc.getContext('2d')!
        frame.drawImage(video, 0, 0, vw, vh)
        const rgba = new Uint8Array(
          frame.getImageData(0, 0, vw, vh).data.buffer,
        )
        uploadTexture(rgba, vw, vh)
      }

      video.onplay = () => {
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (vw <= 0 || vh <= 0) return

        const oc = offscreenRef.current!
        oc.width = vw; oc.height = vh
        const ctx = oc.getContext('2d')!

        const loop = () => {
          if (video.paused) return
          ctx.drawImage(video, 0, 0, vw, vh)
          const idata = ctx.getImageData(0, 0, vw, vh)
          const lrc = getLRC()
          if (lrc && mediaTexRef.current != null) {
            lrc
              .updateTexture(mediaTexRef.current, new Uint8Array(idata.data.buffer))
              .then(() => renderFrame(vw, vh))
              .catch(() => {})
          }
          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      }

      video.play().catch(() => {})

      return () => {
        cancelAnimationFrame(rafRef.current)
        video.pause()
      }
    }
  }, [url, lrcReady])

  // ── 渲染 ──
  if (fatalError) {
    return (
      <div className="preview-stage">
        <p className="preview-stage-error">{fatalError}</p>
      </div>
    )
  }

  if (!url) return null

  return (
    <div className="preview-stage">
      <canvas ref={canvasRef} />
    </div>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import { LrcRender } from './LrcRender'
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
}

export interface MediaResolution {
  width: number
  height: number
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
  const fit: ScaleMode = hasMeasuredFrame ? 'fill' : scaleMode

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

export function PreviewStage({ url, scaleMode = 'contain', extraLayers }: PreviewStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState<StageSize | null>(null)
  // ── 媒体分辨率 ──
  const [resolution, setResolution] = useState<MediaResolution | null>(null)

  // ── 加载状态（url 切换时自动 loading） ──
  const [loading, setLoading] = useState(false)
  const prevUrlRef = useRef<string | null>(null)

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
      .then(setResolution)
      .catch(() => setResolution(null))
  }, [url])

  if (!url || layers.length === 0) return null

  return (
    <div
      ref={stageRef}
      className="preview-stage"
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      <LrcRender layers={layers} onRender={handleRender} />
      {loading && (
        <div className="preview-loading-overlay">
          <div className="preview-loading-spinner" />
        </div>
      )}
    </div>
  )
}

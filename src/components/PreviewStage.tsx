import { useState, useEffect, useMemo, useRef } from 'react'
import { LrcRender, LrcLayer } from './LrcRender'
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

function containFrame(media: MediaResolution, stage: StageSize): Pick<LrcLayer, 'dstX' | 'dstY' | 'dstW' | 'dstH'> {
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
 * 统一构建层数据 — 根据媒体 URL 和缩放模式生成 LrcLayer[]
 *
 * @param url        媒体文件路径
 * @param scaleMode  缩放模式（fill: 拉伸填满 / contain: 保持比例完整显示）
 * @param resolution 媒体真实分辨率，用于按资源比例构建 layer
 * @param stageSize  预览舞台尺寸，用于把资源比例换算成归一化 layer 坐标
 */
export function buildLayers(
  url: string,
  scaleMode: ScaleMode,
  resolution: MediaResolution | null = null,
  stageSize: StageSize | null = null,
): LrcLayer[] {
  const hasMeasuredFrame = scaleMode === 'contain' && isValidSize(resolution) && isValidSize(stageSize)
  const frame = hasMeasuredFrame
    ? containFrame(resolution, stageSize)
    : { dstX: 0, dstY: 0, dstW: 1, dstH: 1 }
  const fit: ScaleMode = hasMeasuredFrame ? 'fill' : scaleMode

  const baseLayer = {
    ...frame,
    fit,
  }

  if (isImage(url)) {
    return [{ ...baseLayer, imagePath: url }]
  }
  if (isVideo(url)) {
    return [{ ...baseLayer, videoPath: url }]
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

export function PreviewStage({ url, scaleMode = 'contain' }: PreviewStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState<StageSize | null>(null)
  // ── 媒体分辨率 ──
  const [resolution, setResolution] = useState<MediaResolution | null>(null)

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
    if (!url) return []
    return buildLayers(url, scaleMode, resolution, stageSize)
  }, [url, scaleMode, resolution, stageSize])

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
      <LrcRender layers={layers} />
    </div>
  )
}

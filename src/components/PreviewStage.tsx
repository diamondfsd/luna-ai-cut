import { useState, useEffect, useMemo } from 'react'
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

/**
 * 统一构建层数据 — 根据媒体 URL 和缩放模式生成 LrcLayer[]
 *
 * @param url       媒体文件路径
 * @param scaleMode 缩放模式（fill: 拉伸填满 / contain: 保持比例完整显示）
 */
export function buildLayers(url: string, scaleMode: ScaleMode): LrcLayer[] {
  const baseLayer = {
    dstX: 0,
    dstY: 0,
    dstW: 1,
    dstH: 1,
    fit: scaleMode,
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
  // ── 层数据状态管理 ──
  const [layers, setLayers] = useState<LrcLayer[]>([])
  // ── 媒体分辨率 ──
  const [resolution, setResolution] = useState<MediaResolution | null>(null)

  // 宽高比（由 resolution 派生）
  const aspectRatio = useMemo(() => {
    if (!resolution) return null
    return calcAspectRatio(resolution.width, resolution.height)
  }, [resolution])

  // 当 url 或 scaleMode 变化时，重新构建层数据
  useEffect(() => {
    if (!url) {
      setLayers([])
      setResolution(null)
      return
    }
    setLayers(buildLayers(url, scaleMode))
  }, [url, scaleMode])

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
      className="preview-stage"
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      <LrcRender layers={layers} />
    </div>
  )
}

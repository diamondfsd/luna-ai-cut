import { useState, useEffect } from 'react'
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

export function PreviewStage({ url, scaleMode = 'contain' }: PreviewStageProps) {
  // ── 层数据状态管理 ──
  const [layers, setLayers] = useState<LrcLayer[]>([])

  // 当 url 或 scaleMode 变化时，重新构建层数据
  useEffect(() => {
    if (!url) {
      setLayers([])
      return
    }
    setLayers(buildLayers(url, scaleMode))
  }, [url, scaleMode])

  if (!url || layers.length === 0) return null

  return (
    <div className="preview-stage">
      <LrcRender layers={layers} />
    </div>
  )
}

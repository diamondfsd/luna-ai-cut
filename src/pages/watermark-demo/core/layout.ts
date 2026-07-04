/**
 * Layout Engine — 将业务配置转换为像素级布局
 *
 * 核心原则（来自 PLAN.md）：
 *   复杂排版算法只在 Layout Engine 里实现一次
 *   预览和导出都不再单独实现排版
 */

import type { Project, ResolvedLayer } from './types'

/**
 * 将归一化坐标 (0-1) 转换为像素坐标
 */
function toPixel(value: number, canvasSize: number): number {
  return Math.round(value * canvasSize)
}

/**
 * 解析媒体层的像素布局
 */
function resolveMediaLayout(
  project: Project,
  canvasWidth: number,
  canvasHeight: number,
): ResolvedLayer {
  // Demo 中只有一个媒体 clip
  const mediaTrack = project.timeline.tracks.find(t => t.type === 'media')
  const clip = mediaTrack?.clips[0]
  const asset = project.assets[0]

  if (!clip || !asset) {
    return {
      layerId: 'media-empty',
      type: 'media',
      srcRect: { x: 0, y: 0, width: 0, height: 0 },
      dstRect: { x: 0, y: 0, width: 0, height: 0 },
      opacity: 0,
      rotation: 0,
      zIndex: 0,
    }
  }

  const { transform } = clip
  const dstW = toPixel(transform.width, canvasWidth)
  const dstH = toPixel(transform.height, canvasHeight)
  const dstX = toPixel(transform.x, canvasWidth)
  const dstY = toPixel(transform.y, canvasHeight)

  // 根据 fit 模式计算源裁剪区域
  let srcW = asset.width
  let srcH = asset.height
  let srcX = 0
  let srcY = 0

  const dstAspect = dstW / dstH
  const srcAspect = srcW / srcH

  if (transform.fit === 'cover') {
    if (srcAspect > dstAspect) {
      // 源更宽 → 裁剪左右
      srcW = Math.round(srcH * dstAspect)
      srcX = Math.round((asset.width - srcW) / 2)
    } else {
      // 源更高 → 裁剪上下
      srcH = Math.round(srcW / dstAspect)
      srcY = Math.round((asset.height - srcH) / 2)
    }
  } else if (transform.fit === 'contain') {
    // contain 模式：整个素材可见，可能有黑边
    // 这里保持源完整，目标区域通过 CSS object-fit 处理
    // 实际渲染时不需要裁剪源
  }
  // 'fill' 模式：拉伸，不裁剪

  return {
    layerId: 'media',
    type: 'media',
    srcRect: { x: srcX, y: srcY, width: srcW, height: srcH },
    dstRect: { x: dstX, y: dstY, width: dstW, height: dstH },
    opacity: transform.opacity,
    rotation: (transform.rotation * Math.PI) / 180,
    zIndex: 0,
  }
}

/**
 * 解析水印层的像素布局
 */
function resolveWatermarkLayout(
  project: Project,
  canvasWidth: number,
  canvasHeight: number,
): ResolvedLayer | null {
  const { watermark } = project
  if (!watermark.enabled) return null

  const config = watermark.config
  const marginPx = toPixel(watermark.marginRatio, Math.max(canvasWidth, canvasHeight))

  let wmWidth: number
  let wmHeight: number

  if (config.type === 'image') {
    wmWidth = Math.round(config.widthRatio * canvasWidth)
    // 保持图片宽高比
    wmHeight = wmWidth // 实际渲染时根据图片比例调整
  } else {
    // 文本水印
    wmWidth = 0 // 文本宽高由 compositor 测量
    wmHeight = toPixel(config.fontSize, canvasWidth)
  }

  // 根据位置计算 x, y
  const [vPos, hPos] = parsePosition(watermark.position)
  let x: number, y: number

  switch (hPos) {
    case 'left':   x = marginPx; break
    case 'center': x = (canvasWidth - wmWidth) / 2; break
    case 'right':  x = canvasWidth - wmWidth - marginPx; break
    default:       x = marginPx
  }

  switch (vPos) {
    case 'top':    y = marginPx; break
    case 'center': y = (canvasHeight - wmHeight) / 2; break
    case 'bottom': y = canvasHeight - wmHeight - marginPx; break
    default:       y = canvasHeight - wmHeight - marginPx
  }

  return {
    layerId: 'watermark',
    type: 'watermark',
    srcRect: { x: 0, y: 0, width: wmWidth, height: wmHeight },
    dstRect: { x, y, width: wmWidth, height: wmHeight },
    opacity: config.opacity,
    rotation: 0,
    zIndex: 10,
  }
}

function parsePosition(position: string): [string, string] {
  const parts = position.split('-')
  if (parts.length === 2) return [parts[0], parts[1]]
  if (position === 'center') return ['center', 'center']
  // 默认右下角
  return ['bottom', 'right']
}

/**
 * 解析布局，生成像素级 Layer 列表
 *
 * 这是整个架构中最关键的环节之一（来自 PLAN.md 的忠告）：
 *   预览和导出调用同一个 resolveLayout，不会出现布局不一致。
 */
export function resolveLayout(
  project: Project,
  canvasWidth: number,
  canvasHeight: number,
): ResolvedLayer[] {
  const layers: ResolvedLayer[] = []

  // 媒体层
  const mediaLayer = resolveMediaLayout(project, canvasWidth, canvasHeight)
  layers.push(mediaLayer)

  // 水印层
  const watermarkLayer = resolveWatermarkLayout(project, canvasWidth, canvasHeight)
  if (watermarkLayer) {
    layers.push(watermarkLayer)
  }

  // 按 zIndex 排序
  layers.sort((a, b) => a.zIndex - b.zIndex)

  return layers
}

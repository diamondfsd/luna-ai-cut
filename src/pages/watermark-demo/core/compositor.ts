/**
 * Compositor — 将 SceneGraph 渲染成帧
 *
 * 这是整个架构的心脏（来自 PLAN.md）：
 *
 *   "预览和导出不是两套算法
 *    而是同一套 renderFrame，在不同质量参数下运行"
 *
 * Preview:
 *   renderFrame(sceneGraph, { width: 540, height: 960, quality: 'preview' })
 *
 * Export:
 *   renderFrame(sceneGraph, { width: 1080, height: 1920, quality: 'export' })
 */

import type { SceneGraph, RenderOptions, RenderedFrame } from './types'

/**
 * 构建 SceneGraph — 聚合所有需要渲染的层
 *
 * @param resolvedLayers Layout Engine 的输出
 * @param canvasWidth 画布宽度
 * @param canvasHeight 画布高度
 * @param background 背景色
 * @param mediaImage 媒体图片元素（已加载）
 * @param watermarkImage 水印图片元素（可选）
 * @param watermarkText 水印文本配置（可选）
 */
export function buildSceneGraph(params: {
  canvas: { width: number; height: number; background: string }
  resolvedLayers: import('./types').ResolvedLayer[]
  mediaImage: HTMLImageElement | HTMLVideoElement | null
  watermarkImage?: HTMLImageElement | null
  watermarkText?: { text: string; fontSize: number; color: string; fontFamily: string } | null
}): SceneGraph {
  const layers: SceneGraph['layers'] = []

  // 媒体层
  const mediaLayer = params.resolvedLayers.find(l => l.type === 'media')
  if (mediaLayer && params.mediaImage) {
    layers.push({
      layerId: mediaLayer.layerId,
      data: { kind: 'image', image: params.mediaImage },
      layout: mediaLayer,
    })
  }

  // 水印层
  const wmLayer = params.resolvedLayers.find(l => l.type === 'watermark')
  if (wmLayer) {
    if (params.watermarkImage) {
      layers.push({
        layerId: wmLayer.layerId,
        data: { kind: 'image', image: params.watermarkImage },
        layout: wmLayer,
      })
    } else if (params.watermarkText) {
      layers.push({
        layerId: wmLayer.layerId,
        data: {
          kind: 'text',
          text: params.watermarkText.text,
          fontSize: params.watermarkText.fontSize,
          color: params.watermarkText.color,
          fontFamily: params.watermarkText.fontFamily,
        },
        layout: wmLayer,
      })
    }
  }

  return {
    canvas: params.canvas,
    layers,
  }
}

/**
 * 渲染一帧 — 预览和导出的唯一渲染入口
 *
 * 流程：
 *   1. 创建离屏 Canvas（按 options 的分辨率）
 *   2. 填充背景
 *   3. 按 zIndex 逐个绘制 layer
 *   4. 返回包含 canvas 的 RenderedFrame
 */
export function renderFrame(sceneGraph: SceneGraph, options: RenderOptions): RenderedFrame {
  const canvas = document.createElement('canvas')
  canvas.width = options.width
  canvas.height = options.height
  const ctx = canvas.getContext('2d')!

  // ── 1. 清空并填充背景 ──
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = sceneGraph.canvas.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // ── 2. 按 zIndex 绘制每个 layer ──
  const sorted = [...sceneGraph.layers].sort((a, b) => a.layout.zIndex - b.layout.zIndex)

  for (const layer of sorted) {
    const { layout, data } = layer
    ctx.save()
    ctx.globalAlpha = layout.opacity

    if (data.kind === 'image') {
      drawImageLayer(ctx, data.image, layout)
    } else if (data.kind === 'text') {
      drawTextLayer(ctx, data, layout)
    }

    ctx.restore()
  }

  return { canvas, width: canvas.width, height: canvas.height }
}

/**
 * 绘制图片/视频层
 */
function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLVideoElement,
  layout: import('./types').ResolvedLayer,
): void {
  const { srcRect, dstRect, rotation } = layout

  // 如果有旋转，先变换
  if (rotation !== 0) {
    const cx = dstRect.x + dstRect.width / 2
    const cy = dstRect.y + dstRect.height / 2
    ctx.translate(cx, cy)
    ctx.rotate(rotation)
    ctx.translate(-cx, -cy)
  }

  // 处理水印图片的宽高比保持
  let dstW = dstRect.width
  let dstH = dstRect.height

  if (image instanceof HTMLImageElement && srcRect.height > 0) {
    const imgAspect = image.naturalWidth / image.naturalHeight
    const rectAspect = dstW / dstH
    if (imgAspect > rectAspect) {
      dstH = dstW / imgAspect
    } else {
      dstW = dstH * imgAspect
    }
  }

  ctx.drawImage(
    image,
    srcRect.x, srcRect.y, srcRect.width || image instanceof HTMLVideoElement ? (image as HTMLVideoElement).videoWidth : (image as HTMLImageElement).naturalWidth, srcRect.height || (image instanceof HTMLVideoElement ? (image as HTMLVideoElement).videoHeight : (image as HTMLImageElement).naturalHeight),
    0, 0,
    dstW,
    dstH,
  )
}

/**
 * 绘制文本水印层
 */
function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  data: { text: string; fontSize: number; color: string; fontFamily: string },
  layout: import('./types').ResolvedLayer,
): void {
  const { dstRect } = layout

  ctx.font = `${data.fontSize}px ${data.fontFamily}`
  ctx.fillStyle = data.color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // 文本在目标区域内居中显示
  const metrics = ctx.measureText(data.text)
  const textWidth = metrics.width
  const textHeight = data.fontSize // 近似高度

  const x = dstRect.x + (dstRect.width - textWidth) / 2
  const y = dstRect.y + (dstRect.height - textHeight) / 2

  ctx.fillText(data.text, x, y)
}

/**
 * 便捷方法：将 RenderedFrame 导出为 Blob
 */
export function frameToBlob(frame: RenderedFrame, format: 'image/png' | 'image/jpeg' = 'image/png', quality: number = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    frame.canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      format,
      quality,
    )
  })
}

/**
 * 便捷方法：下载 RenderedFrame
 */
export function downloadFrame(frame: RenderedFrame, filename: string, format: 'image/png' | 'image/jpeg' = 'image/png'): void {
  const dataUrl = frame.canvas.toDataURL(format, 0.92)
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

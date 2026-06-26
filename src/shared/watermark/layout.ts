/**
 * 纯函数：水印布局计算 — 不依赖 DOM、不依赖 Electron
 *
 * 前端预览和 ffmpeg 导出共用同一套规则，确保视觉比例一致。
 *
 * 使用方式：
 *   前端：contentWidth/Height = getContainRect() 后的图片实际渲染尺寸
 *   后端：contentWidth/Height = 最终输出图片/视频的展示方向尺寸
 */

import type { WatermarkPosition } from '../types'

export interface WatermarkLayoutInput {
  /** 内容区域宽度（图片/视频的展示方向宽度） */
  contentWidth: number
  /** 内容区域高度 */
  contentHeight: number
  /** 水印图片原始宽度 */
  watermarkWidth: number
  /** 水印图片原始高度 */
  watermarkHeight: number
  /** 水印宽度占内容宽度的比例（如 0.18） */
  widthRatio: number
  /** 水平边距占内容宽度的比例（如 0.03） */
  marginXRatio: number
  /** 垂直边距占内容高度的比例（如 0.03） */
  marginYRatio: number
  /** 水印位置 */
  position: WatermarkPosition
  /** 是否限制水印宽度不超过水印图片原始宽度（默认 true） */
  maxOriginalWatermarkWidth?: boolean
}

export interface WatermarkLayout {
  x: number
  y: number
  width: number
  height: number
}

export function calculateWatermarkLayout(input: WatermarkLayoutInput): WatermarkLayout {
  const {
    contentWidth,
    contentHeight,
    watermarkWidth,
    watermarkHeight,
    widthRatio,
    marginXRatio,
    marginYRatio,
    position,
    maxOriginalWatermarkWidth = true,
  } = input

  const aspectRatio = watermarkHeight / watermarkWidth

  let targetW = contentWidth * widthRatio
  if (maxOriginalWatermarkWidth) {
    targetW = Math.min(targetW, watermarkWidth)
  }
  const targetH = targetW * aspectRatio

  const marginX = contentWidth * marginXRatio
  const marginY = contentHeight * marginYRatio

  const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']

  let x: number
  if (hPos === 'left') {
    x = marginX
  } else if (hPos === 'right') {
    x = contentWidth - targetW - marginX
  } else {
    x = (contentWidth - targetW) / 2
  }

  let y: number
  if (vPos === 'bottom') {
    y = contentHeight - targetH - marginY
  } else {
    y = marginY
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(targetW),
    height: Math.round(targetH),
  }
}

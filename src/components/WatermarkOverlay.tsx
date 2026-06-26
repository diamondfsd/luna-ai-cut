import type { WatermarkSettings, WatermarkStyle } from '../shared/types'

import wmUltra from '../assets/watermark/ic_watermark_luna_ultra.png'
import wmUltraCn from '../assets/watermark/ic_watermark_luna_ultra_cn.png'
import wmUltraImage from '../assets/watermark/ic_watermark_luna_ultra_image.png'
import wmUltraImageCn from '../assets/watermark/ic_watermark_luna_ultra_image_cn.png'

/** 水印资源映射：按样式 + 媒体类型区分 */
const WM_SRC: Record<WatermarkStyle, Record<'image' | 'video', string>> = {
  luna_ultra: {
    video: wmUltra,
    image: wmUltraImage,
  },
  luna_ultra_cn: {
    video: wmUltraCn,
    image: wmUltraImageCn,
  },
}

interface WatermarkOverlayProps {
  settings: WatermarkSettings
  kind: 'image' | 'video'
  /** 水印在容器中的像素位置（左上角） */
  x: number
  y: number
  /** 水印渲染像素尺寸 */
  width: number
  height: number
  className?: string
}

/**
 * 水印叠加层 — 只负责渲染，不负责计算尺寸位置。
 * 调用方需传入已算好的像素坐标（px），确保预览与导出视觉一致。
 */
export function WatermarkOverlay({ settings, kind, x, y, width, height, className }: WatermarkOverlayProps) {
  const src = WM_SRC[settings.style]?.[kind]
  if (!settings.enabled || !src) return null

  return (
    <img
      src={src}
      alt=""
      className={className}
      style={{
        position: 'absolute',
        zIndex: 1,
        left: x,
        top: y,
        width,
        height,
        pointerEvents: 'none',
        userSelect: 'none',
        opacity: 0.85,
      }}
      draggable={false}
    />
  )
}

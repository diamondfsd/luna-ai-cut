import type { WatermarkSettings } from '../shared/types'
import { WM_SRC } from '../shared/watermarkAssets'

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
  // style 应已由调用方解析为具体值（如通过 concreteWatermarkStyle）
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

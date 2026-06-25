import type { WatermarkSettings, WatermarkSize, WatermarkStyle } from '../shared/types'
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

/** 水印占容器宽度的百分比（与后端 WATERMARK_SCALE 一致） */
const WM_SCALE: Record<WatermarkSize, number> = {
  small: 0.08,
  medium: 0.12,
  large: 0.18,
}

/** 边距占容器宽度的百分比 */
const WM_MARGIN = 0.03

interface WatermarkOverlayProps {
  settings: WatermarkSettings
  /** 媒体类型，用于选择对应的水印图片（图片和视频的水印布局不同） */
  kind: 'image' | 'video'
  className?: string
}

/**
 * 前端水印覆盖层组件。
 * 使用相对定位（百分比）在媒体内容上方渲染水印。
 * 仅在下载时才会通过后端真正合成水印到文件。
 */
export function WatermarkOverlay({ settings, kind, className }: WatermarkOverlayProps) {
  const src = WM_SRC[settings.style]?.[kind]

  if (!settings.enabled || !src) return null

  const scale = WM_SCALE[settings.size]
  const wmWidth = `${Math.round(scale * 100)}%`
  const margin = `${Math.round(WM_MARGIN * 100)}%`
  const [vPos, hPos] = settings.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']

  const horizontal: React.CSSProperties =
    hPos === 'left' ? { left: margin } :
    hPos === 'right' ? { right: margin } :
    { left: '50%', transform: 'translateX(-50%)' }

  const vertical: React.CSSProperties =
    vPos === 'top' ? { top: margin } :
    { bottom: margin }

  const style: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    width: wmWidth,
    height: 'auto',
    pointerEvents: 'none',
    userSelect: 'none',
    opacity: 0.85,
    ...horizontal,
    ...vertical,
  }

  return (
    <img
      src={src}
      alt=""
      className={className}
      style={style}
      draggable={false}
    />
  )
}

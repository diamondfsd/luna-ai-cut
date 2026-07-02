import type { WatermarkStyle } from './types'

import wmUltra from '../assets/watermark/ic_watermark_luna_ultra.png'
import wmUltraCn from '../assets/watermark/ic_watermark_luna_ultra_cn.png'
import wmUltraImage from '../assets/watermark/ic_watermark_luna_ultra_image.png'
import wmUltraImageCn from '../assets/watermark/ic_watermark_luna_ultra_image_cn.png'
import wmGoUltra from '../assets/watermark/ic_watermark_go_ultra.png'
import wmGoUltraCn from '../assets/watermark/ic_watermark_go_ultra_cn.png'
import wmGoUltraImage from '../assets/watermark/ic_watermark_go_ultra_image.png'
import wmGoUltraImageCn from '../assets/watermark/ic_watermark_go_ultra_image_cn.png'

type ConcreteWatermarkStyle = Exclude<WatermarkStyle, 'auto'>

/** 水印图片 src 映射（同 WatermarkOverlay） */
export const WM_SRC: Record<ConcreteWatermarkStyle, Record<'image' | 'video', string>> = {
  luna_ultra: { video: wmUltra, image: wmUltraImage },
  luna_ultra_cn: { video: wmUltraCn, image: wmUltraImageCn },
  go_ultra: { video: wmGoUltra, image: wmGoUltraImage },
  go_ultra_cn: { video: wmGoUltraCn, image: wmGoUltraImageCn },
}

/** 将 auto 解析为具体样式（与 WatermarkOverlay 一致） */
export function resolveWatermarkStyle(style: WatermarkStyle): ConcreteWatermarkStyle {
  return style === 'auto' ? 'luna_ultra' : style
}

const dimensionCache = new Map<string, { width: number; height: number }>()

export interface WatermarkImageInfo {
  src: string
  width: number
  height: number
}

/**
 * 加载水印图片并返回实际像素尺寸（运行时从 Image.naturalWidth 读取）。
 * 结果会被缓存，同一张图片只加载一次。
 */
export function loadWatermarkImage(style: WatermarkStyle, kind: 'image' | 'video'): Promise<WatermarkImageInfo> {
  const concrete = resolveWatermarkStyle(style)
  const src = WM_SRC[concrete]?.[kind]
  if (!src) throw new Error(`未知水印样式/类型: ${style}/${kind}`)

  const cached = dimensionCache.get(src)
  if (cached) return Promise.resolve({ src, ...cached })

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight }
      dimensionCache.set(src, dims)
      resolve({ src, ...dims })
    }
    img.onerror = () => reject(new Error(`水印图片加载失败: ${src}`))
    img.src = src
  })
}

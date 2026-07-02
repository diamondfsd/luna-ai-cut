import wmUltra from '../assets/watermark/ic_watermark_luna_ultra.png'
import wmUltraCn from '../assets/watermark/ic_watermark_luna_ultra_cn.png'
import wmUltraImage from '../assets/watermark/ic_watermark_luna_ultra_image.png'
import wmUltraImageCn from '../assets/watermark/ic_watermark_luna_ultra_image_cn.png'
import wmGoUltra from '../assets/watermark/ic_watermark_go_ultra.png'
import wmGoUltraCn from '../assets/watermark/ic_watermark_go_ultra_cn.png'
import wmGoUltraImage from '../assets/watermark/ic_watermark_go_ultra_image.png'
import wmGoUltraImageCn from '../assets/watermark/ic_watermark_go_ultra_image_cn.png'

/**
 * 水印图片 src 映射（key = 具体样式标识符，不含 'auto'）。
 * 调用方需先通过 concreteWatermarkStyle() 解析 'auto'。
 */
export const WM_SRC: Record<string, Record<'image' | 'video', string>> = {
  luna_ultra: { video: wmUltra, image: wmUltraImage },
  luna_ultra_cn: { video: wmUltraCn, image: wmUltraImageCn },
  go_ultra: { video: wmGoUltra, image: wmGoUltraImage },
  go_ultra_cn: { video: wmGoUltraCn, image: wmGoUltraImageCn },
}

/** 获取所有已注册的水印样式 key */
export function registeredWatermarkStyles(): string[] {
  return Object.keys(WM_SRC)
}

const dimensionCache = new Map<string, { width: number; height: number }>()

export interface WatermarkImageInfo {
  src: string
  width: number
  height: number
}

/**
 * 加载水印图片并返回实际像素尺寸。
 * @param style 具体样式名（必须是非 'auto' 的已注册值）
 */
export function loadWatermarkImage(style: string, kind: 'image' | 'video'): Promise<WatermarkImageInfo> {
  const src = WM_SRC[style]?.[kind]
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

/**
 * 水印图片 src 映射 — 由文件命名约定自动构建：
 *
 *    ic_watermark_{style}.png          → video
 *    ic_watermark_{style}_image.png    → image
 *
 * 新增水印只需在 src/assets/watermark/ 放对应图片，无需改代码。
 */
const rawModules = import.meta.glob<string>('../assets/watermark/ic_watermark_*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

const SRC: Record<string, Record<'image' | 'video', string>> = {}

for (const [filePath, url] of Object.entries(rawModules)) {
  const fileName = filePath.split('/').pop()!
  const baseName = fileName.replace(/\.png$/, '') // ic_watermark_go_ultra_image

  const isImage = baseName.endsWith('_image')
  const kind: 'image' | 'video' = isImage ? 'image' : 'video'

  // 从文件名提取 style：去掉 ic_watermark_ 前缀和 _image 后缀
  let style = baseName.replace(/^ic_watermark_/, '')
  if (isImage) style = style.replace(/_image$/, '')

  if (!SRC[style]) SRC[style] = { video: '', image: '' }
  SRC[style][kind] = url
}

export const WM_SRC: Readonly<Record<string, Readonly<Record<'image' | 'video', string>>>> = SRC

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

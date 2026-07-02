import goUltraConfig from '../../electron/deviceConfigs/go-ultra.json'
import lunaUltraConfig from '../../electron/deviceConfigs/luna-ultra.json'

interface WatermarkStyleEntry {
  value: string
  label: string
  fileName: string
}

/** 所有设备配置中声明的水印样式（唯一数据源，与 electron/deviceConfigs 保持一致） */
export const ALL_WATERMARK_STYLES: WatermarkStyleEntry[] = [
  ...(goUltraConfig as { watermarkStyles: WatermarkStyleEntry[] }).watermarkStyles,
  ...(lunaUltraConfig as { watermarkStyles: WatermarkStyleEntry[] }).watermarkStyles,
]

/**
 * 水印图片 src 映射 — 由设备配置的 watermarkStyles[].fileName 驱动。
 *
 *    {fileName}.png             → video
 *    {fileName}_image.png       → image
 *
 * 新增水印只需在设备 JSON 的 watermarkStyles 配 { value, label, fileName }，
 * 并在 src/assets/watermark/ 放对应图片文件。
 */
const rawModules = import.meta.glob<string>('../assets/watermark/ic_watermark_*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

const SRC: Record<string, Record<'image' | 'video', string>> = {}

for (const { value, fileName } of ALL_WATERMARK_STYLES) {
  // 从 import.meta.glob 结果中匹配对应图片
  const videoFile = `../assets/watermark/${fileName}.png`
  const imageFile = `../assets/watermark/${fileName}_image.png`
  SRC[value] = {
    video: rawModules[videoFile] ?? '',
    image: rawModules[imageFile] ?? '',
  }
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

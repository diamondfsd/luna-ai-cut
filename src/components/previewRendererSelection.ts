import type { PreviewLayer } from '../shared/types'

/** 视频蒙版需要走支持 maskPath 和线性蒙版纹理的 composition 渲染入口。 */
export function requiresCompositionVideoRenderer(
  isDisplayVideo: boolean,
  layers: PreviewLayer[],
  keepCompositionRenderer = false,
): boolean {
  return isDisplayVideo && (
    keepCompositionRenderer
    || layers.some((layer) => layer.isVideo && Boolean(layer.maskPath))
  )
}

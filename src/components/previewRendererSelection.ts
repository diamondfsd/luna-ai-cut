import type { PreviewLayer } from '../shared/types'

/** 实时预览已能上传蒙版纹理；仅调用方明确要求时使用合成解码器。 */
export function requiresCompositionVideoRenderer(
  isDisplayVideo: boolean,
  _layers: PreviewLayer[],
  keepCompositionRenderer = false,
): boolean {
  return isDisplayVideo && keepCompositionRenderer
}

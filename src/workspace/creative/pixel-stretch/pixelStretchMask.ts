import { createDefaultPipeline, type ColorMaskLayer } from '../../shared/editPipeline'

export const PIXEL_STRETCH_MASK_LAYER_ID = 'pixel-stretch-subject-mask'

export function pixelStretchMaskLayer(path: string, width: number, height: number, current?: ColorMaskLayer): ColorMaskLayer {
  if (current?.path === path) return current
  return {
    path,
    width,
    height,
    opacity: 1,
    inverted: false,
    feather: 1,
    kind: 'brush',
    id: PIXEL_STRETCH_MASK_LAYER_ID,
    name: '像素拉伸主体',
    enabled: true,
    blendMode: 'normal',
    color: current?.color ?? createDefaultPipeline().color,
    components: [{
      id: `component-base-${PIXEL_STRETCH_MASK_LAYER_ID}`,
      type: 'raster',
      operation: 'replace',
      enabled: true,
      inverted: false,
      path,
      width,
      height,
    }],
  }
}

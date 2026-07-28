import { createDefaultPipeline, type ColorMaskLayer } from '../../shared/editPipeline'

export const ONLY_YOUR_COLOR_MASK_LAYER_ID = 'only-your-color-subject-mask'
export const ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID = 'only-your-color-background-mask'

export function onlyYourColorMaskLayer(path: string, width: number, height: number, current?: ColorMaskLayer): ColorMaskLayer {
  if (current?.path === path) return current
  return {
    path,
    width,
    height,
    opacity: 1,
    inverted: false,
    feather: 1,
    kind: 'brush',
    id: ONLY_YOUR_COLOR_MASK_LAYER_ID,
    name: '色彩主体',
    enabled: true,
    blendMode: 'normal',
    color: current?.color ?? createDefaultPipeline().color,
    components: [{
      id: `component-base-${ONLY_YOUR_COLOR_MASK_LAYER_ID}`,
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

export function onlyYourColorBackgroundMaskLayer(path: string, width: number, height: number, current?: ColorMaskLayer): ColorMaskLayer {
  const layer = onlyYourColorMaskLayer(path, width, height, current)
  return {
    ...layer,
    inverted: true,
    id: ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID,
    name: '黑白背景',
    components: layer.components?.map((component) => ({
      ...component,
      id: `component-base-${ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID}`,
    })),
  }
}

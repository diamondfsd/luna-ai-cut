export type {
  Project,
  OutputConfig,
  MediaAsset,
  WatermarkLayer,
  WatermarkConfig,
  WatermarkType,
  WatermarkPosition,
  TextWatermarkConfig,
  ImageWatermarkConfig,
  Clip,
  Track,
  Timeline,
  Rect,
  ResolvedLayer,
  SceneGraph,
  SceneLayer,
  LayerData,
  TextLayerData,
  ImageLayerData,
  RenderQuality,
  RenderOptions,
  RenderedFrame,
} from './types'

export { evaluateTimeline } from './timeline'
export type { ActiveClip } from './timeline'

export { resolveLayout } from './layout'

export {
  buildSceneGraph,
  renderFrame,
  frameToBlob,
  downloadFrame,
} from './compositor'

// 工具函数：创建默认项目
import type { Project } from './types'

export function createDefaultProject(): Project {
  return {
    version: 1,
    output: {
      width: 1920,
      height: 1080,
      background: '#ffffff',
    },
    assets: [],
    timeline: {
      tracks: [],
    },
    watermark: {
      enabled: false,
      config: {
        type: 'text',
        text: 'Watermark',
        fontSize: 0.04,
        color: 'rgba(255, 255, 255, 0.8)',
        opacity: 0.8,
        fontFamily: 'Arial, sans-serif',
      },
      position: 'bottom-right',
      marginRatio: 0.03,
    },
  }
}

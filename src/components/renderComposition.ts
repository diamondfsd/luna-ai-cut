import type { CompositionInput, PreviewLayer } from '../shared/types'

const DEFAULT_COMPOSITION_SIZE = 1440
export const COMPOSITION_RENDER_FPS = 30

function sortedLayers(layers: PreviewLayer[]): PreviewLayer[] {
  return [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

function layerSourceType(layer: PreviewLayer): 'video' | 'image' {
  return layer.isVideo ? 'video' : 'image'
}

/** 将 file:// URL 转回本地文件系统路径，ffprobe/ffmpeg 不支持 URL 编码 */
function toLocalPath(path: string): string {
  if (!path.startsWith('file://')) return path
  return decodeURI(path.slice(7))
}

export function buildCompositionFromPreviewLayers(
  layers: PreviewLayer[],
  width?: number,
  height?: number,
  options?: { fps?: number; duration?: number | null },
): CompositionInput {
  const canvasWidth = Math.max(1, Math.round(width ?? DEFAULT_COMPOSITION_SIZE))
  const canvasHeight = Math.max(1, Math.round(height ?? DEFAULT_COMPOSITION_SIZE))
  const duration = options?.duration

  return {
    version: 1,
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      fps: options?.fps ?? COMPOSITION_RENDER_FPS,
      duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined,
    },
    layers: sortedLayers(layers).map((layer, index) => ({
      id: `layer-${index}`,
      source: {
        path: toLocalPath(layer.filePath),
        sourceType: layerSourceType(layer),
        time: layer.isVideo
          ? {
              start: layer.videoTime ?? 0,
              offset: 0,
              loopEnabled: false,
            }
          : undefined,
      },
      rect: {
        x: layer.dstX,
        y: layer.dstY,
        w: layer.dstW,
        h: layer.dstH,
      },
      fit: 'cover',
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? index,
      color: layer.color,
      transform: layer.transform,
      positioning: layer.positioning,
      lutId: layer.lutId,
    })),
  }
}

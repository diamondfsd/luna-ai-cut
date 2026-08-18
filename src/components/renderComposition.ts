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

/** 与多层预览的解码源复用规则保持一致。 */
export function compositionSourceKey(layer: PreviewLayer): string {
  const path = toLocalPath(layer.filePath)
  if (!layer.isVideo) return `image_${path}`
  return layer.videoSourceKey
    ? `shared_${layer.videoSourceKey}_${path}`
    : `v_${path}_${layer.videoTime ?? 0}`
}

export function buildCompositionFromPreviewLayers(
  layers: PreviewLayer[],
  width?: number,
  height?: number,
  options?: { fps?: number; duration?: number | null },
): CompositionInput {
  const canvasWidth = Math.max(1, Math.round(width ?? DEFAULT_COMPOSITION_SIZE))
  const canvasHeight = Math.max(1, Math.round(height ?? DEFAULT_COMPOSITION_SIZE))

  // 从视频层的 videoDuration 推导画布时长（截取模式），否则用 options.duration
  const videoLayerDuration = layers.find((l) => l.isVideo && l.videoDuration != null)?.videoDuration
  const effectDuration = layers.find((layer) => layer.pixelFlow)?.pixelFlow?.duration
  const duration = videoLayerDuration ?? options?.duration ?? effectDuration

  const composition: CompositionInput = {
    version: 1,
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      // 导出传入 options 但不指定 fps 时表示“跟随源视频”，不能回填 30。
      // 普通预览没有 options，仍使用稳定的 30 fps 合成时基。
      fps: options === undefined ? COMPOSITION_RENDER_FPS : options.fps,
      duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined,
    },
    layers: sortedLayers(layers).map((layer, index) => ({
      id: `layer-${index}`,
      layerType: layer.layerType ?? 'media',
      precomposeGroup: layer.precomposeGroup,
      precomposeRole: layer.precomposeRole,
      source: {
        path: toLocalPath(layer.filePath),
        sourceType: layerSourceType(layer),
        key: compositionSourceKey(layer),
        time: layer.isVideo
          ? {
              start: layer.videoTime ?? 0,
              offset: layer.videoOffset ?? 0,
              duration: layer.videoDuration,
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
      // Crop is expressed in the rotated frame. Keep the base source rect
      // here and let the renderer inverse-map the output crop after rotation.
      sourceRect: { x: layer.srcX, y: layer.srcY, w: layer.srcW, h: layer.srcH },
      fit: layer.fit ?? 'cover',
      opacity: layer.opacity ?? 1,
      blendMode: layer.blendMode,
      zIndex: layer.zIndex ?? index,
      activeStart: layer.activeStart,
      activeEnd: layer.activeEnd,
      reveal: layer.reveal,
      color: layer.color,
      maskPath: layer.maskPath ? toLocalPath(layer.maskPath) : undefined,
      maskProjectId: layer.maskProjectId,
      maskOpacity: layer.maskOpacity,
      maskInverted: layer.maskInverted,
      maskFeather: layer.maskFeather,
      maskTrack: layer.maskTrack,
      maskTimeline: layer.maskTimeline ? {
        ...layer.maskTimeline,
        frames: layer.maskTimeline.frames.map((frame) => ({
          ...frame,
          path: frame.path ? toLocalPath(frame.path) : undefined,
        })),
      } : undefined,
      pixelStretch: layer.pixelStretch,
      pixelFlow: layer.pixelFlow,
      transform: layer.transform,
      positioning: layer.positioning,
      restoreLutId: layer.restoreLutId,
      lutId: layer.lutId,
      lutIntensity: layer.lutIntensity,
      shape: layer.shape,
      fillColor: layer.fillColor,
      cornerRadius: layer.cornerRadius,
      strokeColor: layer.strokeColor,
      strokeWidth: layer.strokeWidth,
      content: layer.content,
      fontSize: layer.fontSize,
      fontFamily: layer.fontFamily,
      fontFile: layer.fontFile,
      fontWeight: layer.fontWeight,
      textColor: layer.textColor,
      textAlign: layer.textAlign,
      verticalAlign: layer.verticalAlign,
    })),
  }

  return composition
}

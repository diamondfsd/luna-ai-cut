import type { PreviewLayer } from '../../../shared/types'

interface ColorRevealLayerOptions {
  sourcePath: string
  layers: PreviewLayer[]
  isVideo: boolean
  trimStart: number
  sourceDuration: number
  effectStart: number
  revealStart: number
  transitionDuration: number
  midpointHoldDuration: number
  saturation: number
  gray: number
  stageMode: 'two' | 'three'
  forExport: boolean
}

export function buildColorRevealLayers(options: ColorRevealLayerOptions): PreviewLayer[] {
  const {
    sourcePath,
    layers,
    isVideo,
    trimStart,
    sourceDuration,
    effectStart,
    revealStart,
    transitionDuration,
    midpointHoldDuration,
    saturation,
    gray,
    stageMode,
    forExport,
  } = options

  return layers.flatMap((layer) => {
    if (layer.filePath !== sourcePath) return [layer]
    const afterColor = layer.color
    const beforeColor = afterColor ? {
      ...afterColor,
      saturation: Math.max(-100, Math.min(100, afterColor.saturation + saturation - gray * 0.2)),
      contrast: Math.max(-100, Math.min(100, afterColor.contrast - gray * 0.55)),
      shadows: Math.max(-100, Math.min(100, afterColor.shadows + gray * 0.28)),
      blacks: Math.max(-100, Math.min(100, afterColor.blacks + gray * 0.32)),
      whites: Math.max(-100, Math.min(100, afterColor.whites - gray * 0.22)),
      clarity: Math.max(-100, Math.min(100, afterColor.clarity - gray * 0.18)),
      curveLift: Math.max(-100, Math.min(100, afterColor.curveLift + gray * 0.12)),
    } : afterColor
    const shared: PreviewLayer = {
      ...layer,
      fit: 'cover',
      ...(isVideo ? {
        videoTime: trimStart,
        videoOffset: forExport ? effectStart : undefined,
        videoDuration: sourceDuration || undefined,
        videoSourceKey: 'color-reveal-main',
      } : {}),
    }
    const grayLayer: PreviewLayer = {
      ...shared,
      color: beforeColor,
      lutId: undefined,
      lutIntensity: undefined,
    }

    if (stageMode === 'two') {
      return [
        grayLayer,
        {
          ...shared,
          zIndex: layer.zIndex + 0.01,
          reveal: {
            direction: 'left-to-right',
            start: revealStart,
            duration: transitionDuration,
            midpointHold: midpointHoldDuration,
            easing: 'ease-in-out',
          },
        },
      ]
    }

    const halfDuration = transitionDuration / 2
    return [
      grayLayer,
      {
        ...shared,
        color: undefined,
        lutId: undefined,
        lutIntensity: undefined,
        zIndex: layer.zIndex + 0.01,
        reveal: {
          direction: 'left-to-right',
          start: revealStart,
          duration: halfDuration,
          easing: 'ease-in-out',
        },
      },
      {
        ...shared,
        zIndex: layer.zIndex + 0.02,
        reveal: {
          direction: 'left-to-right',
          start: revealStart + halfDuration + midpointHoldDuration,
          duration: halfDuration,
          easing: 'ease-in-out',
        },
      },
    ]
  })
}

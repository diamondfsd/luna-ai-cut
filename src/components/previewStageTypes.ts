import type { ReactNode } from 'react'
import type { PreviewLayer } from '../shared/types'
import type { EditPipeline } from '../workspace/shared/editPipeline'

export interface PreviewStageHandle {
  seek: (time: number) => void
  togglePlay: () => void
  getCurrentTime: () => number
  getDuration: () => number
  isPlaying: () => boolean
}

export interface PreviewStageProps {
  url: string | null
  active?: boolean
  isLivePhoto?: boolean
  pending?: boolean
  extraLayers?: PreviewLayer[]
  pipeline?: EditPipeline
  cropActive?: boolean
  hideControls?: boolean
  onMetricsChange?: (metrics: { imageRect: { x: number; y: number; width: number; height: number }; sourceAspect: number }) => void
  onMediaSize?: (width: number, height: number) => void
  renderOverlay?: () => ReactNode
  viewScale?: 'fit' | number
  onViewScaleChange?: (scale: 'fit' | number) => void
  onFitScaleChange?: (scale: number) => void
  viewportKey?: string
  previewMaxSide?: number
  keepCompositionVideoRenderer?: boolean
  onPlayStateChange?: (state: { playing: boolean; currentTime: number; duration: number }) => void
}

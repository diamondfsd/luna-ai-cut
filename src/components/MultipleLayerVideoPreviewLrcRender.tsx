import { memo } from 'react'

import type { PreviewLayer } from '../shared/types'
import { WebGpuVideoPreview } from './WebGpuVideoPreview'

export interface MultipleLayerVideoPreviewLrcRenderProps {
  layers: PreviewLayer[]
  className?: string
  canvasWidth?: number
  canvasHeight?: number
  maxSide?: number
  playing?: boolean
  compositionTime?: number
  /** Kept for call-site compatibility; WebGPU manages source resolution directly. */
  decodeQuality?: number
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  onVideoElement?: (element: HTMLVideoElement | null) => void
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
  maxImageScale?: number
  interactiveImageLayerIndexes?: readonly number[]
  viewportKey?: string
}

/**
 * Compatibility name for creative callers while the shared implementation is WebGPU.
 * The component no longer creates native textures or calls the Rust renderer.
 */
export const MultipleLayerVideoPreviewLrcRender = memo(function MultipleLayerVideoPreviewLrcRender({
  canvasWidth = 1440,
  canvasHeight = 810,
  ...props
}: MultipleLayerVideoPreviewLrcRenderProps) {
  return (
    <WebGpuVideoPreview
      {...props}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    />
  )
})

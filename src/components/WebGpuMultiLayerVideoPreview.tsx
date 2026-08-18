import { memo } from 'react'

import type { PreviewLayer } from '../shared/types'
import { WebGpuVideoPreview } from './WebGpuVideoPreview'

export interface WebGpuMultiLayerVideoPreviewProps {
  layers: PreviewLayer[]
  className?: string
  canvasWidth?: number
  canvasHeight?: number
  maxSide?: number
  playing?: boolean
  compositionTime?: number
  /** WebGPU manages source resolution directly. */
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

export const WebGpuMultiLayerVideoPreview = memo(function WebGpuMultiLayerVideoPreview({
  canvasWidth = 1440,
  canvasHeight = 810,
  ...props
}: WebGpuMultiLayerVideoPreviewProps) {
  return (
    <WebGpuVideoPreview
      {...props}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    />
  )
})

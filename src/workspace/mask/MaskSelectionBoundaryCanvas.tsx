import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { createMaskSelectionBoundary, drawMaskSelectionBoundary } from './maskSelectionBoundary'

export interface MaskSelectionBoundaryHandle {
  show: (mask: Float32Array) => void
  clear: () => void
}

interface Props {
  width: number
  height: number
}

export const MaskSelectionBoundaryCanvas = forwardRef<MaskSelectionBoundaryHandle, Props>(function MaskSelectionBoundaryCanvas({ width, height }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boundaryRef = useRef<{ path: Path2D; width: number; height: number } | null>(null)
  const animationRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    boundaryRef.current = null
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const show = useCallback((mask: Float32Array) => {
    boundaryRef.current = {
      path: createMaskSelectionBoundary(mask, width, height),
      width,
      height,
    }
    if (animationRef.current !== null) return
    const animate = (time: number): void => {
      const canvas = canvasRef.current
      const boundary = boundaryRef.current
      if (!canvas || !boundary) {
        animationRef.current = null
        return
      }
      const cssWidth = Math.max(1, canvas.clientWidth)
      const cssHeight = Math.max(1, canvas.clientHeight)
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      const backingWidth = Math.max(1, Math.round(cssWidth * pixelRatio))
      const backingHeight = Math.max(1, Math.round(cssHeight * pixelRatio))
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      const context = canvas.getContext('2d')
      if (context) {
        context.clearRect(0, 0, backingWidth, backingHeight)
        const pathScaleX = backingWidth / boundary.width
        const pathScaleY = backingHeight / boundary.height
        const cssToPathScale = Math.max(0.25, (boundary.width / cssWidth + boundary.height / cssHeight) / 2)
        context.save()
        context.scale(pathScaleX, pathScaleY)
        drawMaskSelectionBoundary(context, boundary.path, -(time / 45) % 8, cssToPathScale)
        context.restore()
      }
      animationRef.current = requestAnimationFrame(animate)
    }
    animationRef.current = requestAnimationFrame(animate)
  }, [height, width])

  useImperativeHandle(ref, () => ({ show, clear }), [clear, show])
  useEffect(() => clear, [clear])

  return <canvas ref={canvasRef} className="workspace-mask-selection-boundary" aria-hidden="true" />
})

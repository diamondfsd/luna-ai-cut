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
  const pathRef = useRef<Path2D | null>(null)
  const animationRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    pathRef.current = null
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, width, height)
  }, [height, width])

  const show = useCallback((mask: Float32Array) => {
    pathRef.current = createMaskSelectionBoundary(mask, width, height)
    if (animationRef.current !== null) return
    const animate = (time: number): void => {
      const canvas = canvasRef.current
      const path = pathRef.current
      if (!canvas || !path) {
        animationRef.current = null
        return
      }
      const context = canvas.getContext('2d')
      if (context) {
        context.clearRect(0, 0, width, height)
        const scale = Math.max(0.5, Math.min(width / Math.max(1, canvas.clientWidth), height / Math.max(1, canvas.clientHeight)))
        drawMaskSelectionBoundary(context, path, -(time / 45) % 8, scale)
      }
      animationRef.current = requestAnimationFrame(animate)
    }
    animationRef.current = requestAnimationFrame(animate)
  }, [height, width])

  useImperativeHandle(ref, () => ({ show, clear }), [clear, show])
  useEffect(() => clear, [clear])

  return <canvas ref={canvasRef} className="workspace-mask-selection-boundary" width={width} height={height} aria-hidden="true" />
})

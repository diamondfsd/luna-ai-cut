import { useCallback, useState } from 'react'

interface ViewDrag {
  x: number
  y: number
  pan: { x: number; y: number }
}

export function useViewport() {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<ViewDrag | null>(null)

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault()
    setZoom((current) => {
      const next = Math.max(1, Math.min(4, current * (event.deltaY > 0 ? 0.9 : 1.1)))
      if (next === 1) setPan({ x: 0, y: 0 })
      return Math.round(next * 100) / 100
    })
  }, [])

  const resetViewport = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (zoom <= 1 || event.button !== 0) return
      setDrag({ x: event.clientX, y: event.clientY, pan })
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
    },
    [zoom, pan],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      setPan((currentPan) => {
        if (!drag) return currentPan
        return {
          x: drag.pan.x + event.clientX - drag.x,
          y: drag.pan.y + event.clientY - drag.y,
        }
      })
    },
    [drag],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!drag) return
      setDrag(null)
      const target = event.currentTarget as HTMLElement
      target.releasePointerCapture(event.pointerId)
    },
    [drag],
  )

  return {
    zoom,
    pan,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    resetViewport,
  }
}

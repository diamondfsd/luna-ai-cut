import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Move3d } from 'lucide-react'

import '../styles/live-gimbal-pad.css'

interface LiveGimbalPadProps {
  disabled?: boolean
  onMove: (horizontal: number, vertical: number) => void
  onStop: () => void
}

const TRAVEL = 45

export function LiveGimbalPad({ disabled, onMove, onStop }: LiveGimbalPadProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const activePointerRef = useRef<number | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const stop = useCallback(() => {
    if (activePointerRef.current == null) return
    activePointerRef.current = null
    setPosition({ x: 0, y: 0 })
    onStop()
  }, [onStop])

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [stop])

  useEffect(() => () => {
    if (activePointerRef.current == null) return
    activePointerRef.current = null
    onStop()
  }, [onStop])

  const update = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const deltaX = clientX - (rect.left + rect.width / 2)
    const deltaY = clientY - (rect.top + rect.height / 2)
    const distance = Math.hypot(deltaX, deltaY)
    const scale = distance > TRAVEL ? TRAVEL / distance : 1
    const x = deltaX * scale
    const y = deltaY * scale
    setPosition({ x, y })
    onMove(
      Math.max(-1, Math.min(1, x / TRAVEL)),
      Math.max(-1, Math.min(1, -y / TRAVEL)),
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    activePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    update(event.clientX, event.clientY)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    update(event.clientX, event.clientY)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    stop()
  }

  return (
    <div
      ref={padRef}
      className="live-gimbal-pad-control"
      role="application"
      aria-label="云台方向"
      data-active={position.x !== 0 || position.y !== 0}
      data-disabled={disabled ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      <Move3d size={30} aria-hidden="true" />
      <span
        className="live-gimbal-pad-knob"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      />
    </div>
  )
}

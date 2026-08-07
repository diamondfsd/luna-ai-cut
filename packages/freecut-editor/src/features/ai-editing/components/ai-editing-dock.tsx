import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AiEditingPanel } from './ai-editing-panel'

interface AiEditingDockProps {
  onClose(): void
}

const MIN_WIDTH = 320
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 380
const WIDTH_STORAGE_KEY = 'editor:aiEditingAssistantWidth'

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

function loadWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) ? clampWidth(stored) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export function AiEditingDock({ onClose }: AiEditingDockProps) {
  const [width, setWidth] = useState(loadWidth)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)
  const widthRef = useRef(width)

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return
      const nextWidth = clampWidth(startWidthRef.current + startXRef.current - event.clientX)
      widthRef.current = nextWidth
      setWidth(nextWidth)
    }

    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current))
      } catch {
        // Keep the current size for this editor session when storage is unavailable.
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    isResizingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background"
      style={{ width }}
      aria-label="剪辑助手"
    >
      <div
        data-testid="ai-editing-resize-handle"
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/50 active:bg-primary/50"
        onMouseDown={handleResizeStart}
        aria-hidden="true"
      />
      <AiEditingPanel onClose={onClose} />
    </aside>
  )
}

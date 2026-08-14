import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@freecut/components/ui/button'
import { ChevronLeft, GripVertical } from 'lucide-react'
import { useSettingsStore } from '@freecut/features/editor/deps/settings'
import { useEditorStore } from '@freecut/shared/state/editor'
import {
  clampAiEditorSidebarWidth,
  EDITOR_LAYOUT_CSS_VALUES,
  getAiEditorSidebarBounds,
  getEditorLayout,
} from '@freecut/config/editor-layout'
import './deepseek-harness-dock.css'

const LazyDeepSeekHarnessPanel = lazy(() =>
  import('./deepseek-harness-panel').then((module) => ({ default: module.DeepSeekHarnessPanel })),
)

function DeepSeekHarnessPanelLoading() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
      正在打开 AI 助手…
    </div>
  )
}

export const DeepSeekHarnessDock = memo(function DeepSeekHarnessDock({ projectId }: { projectId: string }) {
  const editorDensity = useSettingsStore((state) => state.editorDensity)
  const editorLayout = getEditorLayout(editorDensity)
  const aiSidebarOpen = useEditorStore((state) => state.aiSidebarOpen)
  const aiSidebarWidth = useEditorStore((state) => state.aiSidebarWidth)
  const setAiSidebarOpen = useEditorStore((state) => state.setAiSidebarOpen)
  const setAiSidebarWidth = useEditorStore((state) => state.setAiSidebarWidth)
  const prefersReducedMotion = useReducedMotion()
  const [contentVisible, setContentVisible] = useState(aiSidebarOpen)
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    if (aiSidebarOpen) setContentVisible(true)
  }, [aiSidebarOpen])

  const finishResize = useCallback(() => {
    if (!isResizingRef.current) return
    isResizingRef.current = false
    setIsResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingRef.current) return
      const delta = startXRef.current - event.clientX
      setAiSidebarWidth(clampAiEditorSidebarWidth(startWidthRef.current + delta, editorLayout))
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', finishResize)
    document.addEventListener('pointercancel', finishResize)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', finishResize)
      document.removeEventListener('pointercancel', finishResize)
      finishResize()
    }
  }, [editorLayout, finishResize, setAiSidebarWidth])

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      isResizingRef.current = true
      setIsResizing(true)
      startXRef.current = event.clientX
      startWidthRef.current = aiSidebarWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [aiSidebarWidth],
  )

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const bounds = getAiEditorSidebarBounds(editorLayout)
      const step = event.shiftKey ? 40 : 16
      let nextWidth: number | null = null
      if (event.key === 'ArrowLeft') nextWidth = aiSidebarWidth + step
      if (event.key === 'ArrowRight') nextWidth = aiSidebarWidth - step
      if (event.key === 'Home') nextWidth = bounds.maxWidth
      if (event.key === 'End') nextWidth = bounds.minWidth
      if (nextWidth === null) return
      event.preventDefault()
      setAiSidebarWidth(clampAiEditorSidebarWidth(nextWidth, editorLayout))
    },
    [aiSidebarWidth, editorLayout, setAiSidebarWidth],
  )

  return (
    <>
      <motion.div
        className="deepseek-harness-dock relative h-full overflow-hidden border-l border-border"
        initial={false}
        animate={{ width: aiSidebarOpen ? aiSidebarWidth : 0 }}
        transition={
          isResizing || prefersReducedMotion
            ? { duration: 0 }
            : { type: 'tween', duration: aiSidebarOpen ? 0.26 : 0.2, ease: [0.32, 0.72, 0, 1] }
        }
        onAnimationComplete={() => {
          if (!aiSidebarOpen) setContentVisible(false)
        }}
      >
        {contentVisible && (
          <div className="deepseek-harness-dock__content h-full" style={{ width: aiSidebarWidth }}>
            <Suspense fallback={<DeepSeekHarnessPanelLoading />}>
              <LazyDeepSeekHarnessPanel projectId={projectId} onClose={() => setAiSidebarOpen(false)} />
            </Suspense>
          </div>
        )}
        {aiSidebarOpen && (
          <div
            className="deepseek-harness-dock__resize-handle"
            data-resizing={isResizing}
            role="separator"
            aria-label="调整 AI 面板宽度"
            aria-orientation="vertical"
            aria-valuemin={editorLayout.aiSidebarMinWidth}
            aria-valuemax={editorLayout.aiSidebarMaxWidth}
            aria-valuenow={aiSidebarWidth}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          >
            <GripVertical className="absolute left-1/2 top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/60" />
          </div>
        )}
      </motion.div>

      {!aiSidebarOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="deepseek-harness-dock__reveal"
          style={{
            width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
            height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
          }}
          onClick={() => setAiSidebarOpen(true)}
          data-tooltip="打开 AI 助手"
          data-tooltip-side="left"
          aria-label="打开 AI 助手"
        >
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      )}
    </>
  )
})

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface PreviewMetrics {
  imageRect: { x: number; y: number; width: number; height: number }
  sourceAspect: number
}

interface WorkspaceCanvasValue extends PreviewMetrics {
  setPreviewMetrics: (metrics: PreviewMetrics) => void
}

const DEFAULT_IMAGE_RECT = { x: 0, y: 0, width: 1, height: 1 }

const WorkspaceCanvasContext = createContext<WorkspaceCanvasValue | null>(null)

export function useWorkspaceCanvas(): WorkspaceCanvasValue {
  const ctx = useContext(WorkspaceCanvasContext)
  if (!ctx) throw new Error('useWorkspaceCanvas must be used within WorkspaceCanvasProvider')
  return ctx
}

export function WorkspaceCanvasProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<PreviewMetrics>({
    imageRect: DEFAULT_IMAGE_RECT,
    sourceAspect: 1,
  })

  const setPreviewMetrics = useCallback((next: PreviewMetrics) => {
    setMetrics((current) => {
      const sameRect =
        Math.abs(current.imageRect.x - next.imageRect.x) < 0.5 &&
        Math.abs(current.imageRect.y - next.imageRect.y) < 0.5 &&
        Math.abs(current.imageRect.width - next.imageRect.width) < 0.5 &&
        Math.abs(current.imageRect.height - next.imageRect.height) < 0.5
      const sameAspect = Math.abs(current.sourceAspect - next.sourceAspect) < 0.0001
      return sameRect && sameAspect ? current : next
    })
  }, [])

  const value = useMemo<WorkspaceCanvasValue>(
    () => ({
      ...metrics,
      setPreviewMetrics,
    }),
    [metrics, setPreviewMetrics],
  )

  return (
    <WorkspaceCanvasContext.Provider value={value}>
      {children}
    </WorkspaceCanvasContext.Provider>
  )
}

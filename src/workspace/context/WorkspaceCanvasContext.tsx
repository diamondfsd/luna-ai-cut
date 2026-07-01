import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import { useCanvasEngine } from '../hooks/useCanvasEngine'
import type { ImageCacheEntry } from '../shared/imageCache'
import { useWorkspaceMedia } from './WorkspaceMediaContext'

// ── helper: apply thumbnail to a media list ──
function applyThumb<T extends { path: string; thumbnailUrl?: string | null }>(
  items: T[],
  targetPath: string,
  thumbnailUrl: string,
): T[] {
  return items.map((item) =>
    item.path === targetPath ? { ...item, thumbnailUrl } : item,
  ) as T[]
}

interface WorkspaceCanvasValue {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  imageLoading: boolean
  imageError: string | null
  webglMessage: string | null
  imageRect: { x: number; y: number; width: number; height: number }
  sourceAspect: number
  canRender: boolean
  render: (pipeline: EditPipeline, opts?: { cropMode?: boolean }) => void
  rendererReady: boolean
  renderKey: number
}

const WorkspaceCanvasContext = createContext<WorkspaceCanvasValue | null>(null)

export function useWorkspaceCanvas(): WorkspaceCanvasValue {
  const ctx = useContext(WorkspaceCanvasContext)
  if (!ctx) throw new Error('useWorkspaceCanvas must be used within WorkspaceCanvasProvider')
  return ctx
}

export function WorkspaceCanvasProvider({ children }: { children: ReactNode }) {
  const { activeMedia, editorOpen, setCurrentProject, setTransientMedia, setBrokenPaths } = useWorkspaceMedia()

  const onThumbnailReady = useCallback(
    (entry: ImageCacheEntry) => {
      if (!activeMedia) return
      // Only works when inside WorkspaceMediaProvider
      setCurrentProject?.((prev) => {
        if (!prev) return prev
        const next = {
          ...prev,
          assets: applyThumb(prev.assets, activeMedia.path, entry.thumbnailUrl),
        }
        window.luna.workspace.saveProject(next).catch(() => undefined)
        return next
      })
      setTransientMedia?.((prev) => applyThumb(prev, activeMedia.path, entry.thumbnailUrl))
    },
    [activeMedia, setCurrentProject, setTransientMedia],
  )

  const onBrokenPath = useCallback(
    (path: string) => {
      setBrokenPaths?.((prev) => new Set(prev).add(path))
    },
    [setBrokenPaths],
  )

  const engine = useCanvasEngine({
    editorOpen,
    activeMedia,
    onThumbnailReady,
    onBrokenPath,
  })

  const value = useMemo<WorkspaceCanvasValue>(
    () => ({
      canvasRef: engine.canvasRef,
      stageRef: engine.stageRef,
      imageLoading: engine.imageLoading,
      imageError: engine.imageError,
      webglMessage: engine.webglMessage,
      imageRect: engine.imageRect,
      sourceAspect: engine.sourceAspect,
      canRender: engine.canRender,
      render: engine.render,
      rendererReady: engine.rendererReady,
      renderKey: engine.renderKey,
    }),
    [engine],
  )

  return (
    <WorkspaceCanvasContext.Provider value={value}>
      {children}
    </WorkspaceCanvasContext.Provider>
  )
}

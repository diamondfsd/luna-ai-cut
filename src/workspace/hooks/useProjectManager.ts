import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../../shared/types'
import { toast } from '../../ui'
import { logger } from '../../lib/rendererLogger'

export interface WorkspaceRouteState {
  project?: WorkspaceProject
  media?: WorkspaceMediaAsset[]
  mediaPaths?: string[]
  initialIndex?: number
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])

function kindFromPath(filePath: string): 'image' | 'video' {
  const segments = filePath.split('.')
  const ext = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : ''
  return VIDEO_EXTS.has(ext) ? 'video' : 'image'
}

function mediaFromState(state: WorkspaceRouteState | null): WorkspaceMediaAsset[] {
  if (state?.media?.length) return state.media
  return (state?.mediaPaths ?? []).map((path, index) => ({
    id: `${path}:${index}`,
    name: fileNameFromPath(path),
    path,
    kind: kindFromPath(path),
  }))
}

export function useProjectManager(routeState: WorkspaceRouteState | null, locationKey: string) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [projectLoading, setProjectLoading] = useState(false)
  const [currentProject, setCurrentProject] = useState<WorkspaceProject | null>(
    routeState?.project ?? null,
  )
  const [transientMedia, setTransientMedia] = useState<WorkspaceMediaAsset[]>(
    mediaFromState(routeState),
  )
  const [activeIndex, setActiveIndex] = useState(routeState?.initialIndex ?? 0)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [brokenPaths, setBrokenPaths] = useState<Set<string>>(new Set())
  const saveTimerRef = useRef<number | null>(null)

  const media = currentProject?.assets ?? transientMedia
  const activeMedia = media[activeIndex] ?? null
  const editorOpen = Boolean(currentProject || transientMedia.length > 0)

  logger.info(`[Workspace] useProjectManager init`, {
    hasRouteProject: !!routeState?.project,
    routeMediaPathsCount: routeState?.mediaPaths?.length ?? 0,
    routeMediaCount: routeState?.media?.length ?? 0,
    transientMediaCount: transientMedia.length,
    currentProjectId: currentProject?.id ?? null,
    currentProjectAssets: currentProject?.assets?.length ?? 0,
    activeIndex,
    hasActiveMedia: !!activeMedia,
    editorOpen,
    locationKey,
  })

  useEffect(() => {
    setProjectLoading(true)
    window.luna.workspace.listProjects()
      .then(setProjects)
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setProjectLoading(false))
  }, [])

  useEffect(() => {
    if (routeState?.project) {
      setCurrentProject(routeState.project)
      setActiveIndex(Math.min(routeState.initialIndex ?? 0, routeState.project.assets.length - 1))
    } else if (mediaFromState(routeState).length) {
      const fallback = mediaFromState(routeState)
      setTransientMedia(fallback)
      setActiveIndex(Math.min(routeState?.initialIndex ?? 0, fallback.length - 1))
    }
  }, [locationKey])

  // Multi-select: Shift range, Ctrl/Cmd toggle
  const handleSelectionChange = useCallback(
    (clickedIndex: number, modifiers: { shift: boolean; ctrl: boolean; meta: boolean }) => {
      setSelectedIndices((prev) => {
        if (modifiers.shift && prev.size > 0) {
          const sorted = [...prev].sort((a, b) => a - b)
          const nearest = sorted.reduce((best, i) =>
            Math.abs(i - clickedIndex) < Math.abs(best - clickedIndex) ? i : best,
          )
          const [from, to] = nearest < clickedIndex ? [nearest, clickedIndex] : [clickedIndex, nearest]
          const range = new Set<number>()
          for (let i = from; i <= to; i++) range.add(i)
          return range
        }
        if (modifiers.ctrl || modifiers.meta) {
          const next = new Set(prev)
          if (next.has(clickedIndex)) next.delete(clickedIndex)
          else next.add(clickedIndex)
          return next
        }
        return new Set([clickedIndex])
      })
    },
    [],
  )

  const openProject = useCallback((project: WorkspaceProject) => {
    setCurrentProject(project)
    setActiveIndex(0)
  }, [])

  const backToProjects = useCallback(() => {
    setCurrentProject(null)
    window.luna.workspace.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const removeMedia = useCallback(
    (index: number) => {
      const totalItems = currentProject ? currentProject.assets.length : transientMedia.length
      if (!activeMedia || totalItems <= 1) return

      if (!currentProject) {
        setTransientMedia((prev) => prev.filter((_, i) => i !== index))
      } else {
        const nextAssets = currentProject.assets.filter((_, i) => i !== index)
        const nextProject = {
          ...currentProject,
          assets: nextAssets,
          updatedAt: new Date().toISOString(),
        }
        setCurrentProject(nextProject)
        window.luna.workspace.saveProject(nextProject).catch(() => undefined)
      }

      if (index <= activeIndex && activeIndex > 0) {
        setActiveIndex(activeIndex - 1)
      } else if (index === activeIndex && activeIndex === totalItems - 1) {
        setActiveIndex(Math.max(0, activeIndex - 1))
      }
    },
    [activeIndex, activeMedia, currentProject, transientMedia.length],
  )

  const removeSelected = useCallback(
    (indices: Set<number>) => {
      if (indices.size < 1 || indices.size >= media.length) return

      if (!currentProject) {
        setTransientMedia((prev) => prev.filter((_, i) => !indices.has(i)))
      } else {
        const nextAssets = currentProject.assets.filter((_, i) => !indices.has(i))
        const nextProject = {
          ...currentProject,
          assets: nextAssets,
          updatedAt: new Date().toISOString(),
        }
        setCurrentProject(nextProject)
        window.luna.workspace.saveProject(nextProject).catch(() => undefined)
      }

      const removedBeforeActive = [...indices].filter((i) => i < activeIndex).length
      const remaining = media.length - indices.size
      setActiveIndex(Math.max(0, Math.min(activeIndex - removedBeforeActive, remaining - 1)))
      setSelectedIndices(new Set())
    },
    [activeIndex, currentProject, media.length],
  )

  const removeBrokenAssets = useCallback(() => {
    if (!currentProject) {
      setTransientMedia((prev) => prev.filter((item) => !brokenPaths.has(item.path)))
      setBrokenPaths(new Set())
      return
    }
    const nextAssets = currentProject.assets.filter((item) => !brokenPaths.has(item.path))
    const nextProject = { ...currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
    setCurrentProject(nextProject)
    setBrokenPaths(new Set())
    window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    if (activeIndex >= nextAssets.length) setActiveIndex(Math.max(0, nextAssets.length - 1))
  }, [activeIndex, brokenPaths, currentProject])

  return {
    projects,
    projectLoading,
    currentProject,
    setCurrentProject,
    transientMedia,
    setTransientMedia,
    activeIndex,
    setActiveIndex,
    selectedIndices,
    setSelectedIndices,
    brokenPaths,
    setBrokenPaths,
    media,
    activeMedia,
    editorOpen,
    saveTimerRef,
    handleSelectionChange,
    openProject,
    backToProjects,
    removeMedia,
    removeSelected,
    removeBrokenAssets,
  }
}

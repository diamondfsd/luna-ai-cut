import { createContext, useContext, type ReactNode } from 'react'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../../shared/types'
import { useProjectManager, type WorkspaceRouteState } from '../hooks/useProjectManager'

interface WorkspaceMediaValue {
  projects: WorkspaceProject[]
  projectLoading: boolean
  currentProject: WorkspaceProject | null
  setCurrentProject: React.Dispatch<React.SetStateAction<WorkspaceProject | null>>
  transientMedia: WorkspaceMediaAsset[]
  setTransientMedia: React.Dispatch<React.SetStateAction<WorkspaceMediaAsset[]>>
  media: WorkspaceMediaAsset[]
  activeIndex: number
  activeMedia: WorkspaceMediaAsset | null
  selectedIndices: Set<number>
  setSelectedIndices: React.Dispatch<React.SetStateAction<Set<number>>>
  brokenPaths: Set<string>
  setBrokenPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  editorOpen: boolean
  handleSelectionChange: (clickedIndex: number, modifiers: { shift: boolean; ctrl: boolean; meta: boolean }) => void
  openProject: (project: WorkspaceProject) => void
  backToProjects: () => void
  removeMedia: (index: number) => void
  removeSelected: (indices: Set<number>) => void
  removeBrokenAssets: () => void
  setActiveIndex: (index: number) => void
}

const WorkspaceMediaContext = createContext<WorkspaceMediaValue | null>(null)

export function useWorkspaceMedia(): WorkspaceMediaValue {
  const ctx = useContext(WorkspaceMediaContext)
  if (!ctx) throw new Error('useWorkspaceMedia must be used within WorkspaceMediaProvider')
  return ctx
}

interface WorkspaceMediaProviderProps {
  routeState: WorkspaceRouteState | null
  locationKey: string
  children: ReactNode
}

export function WorkspaceMediaProvider({ routeState, locationKey, children }: WorkspaceMediaProviderProps) {
  const manager = useProjectManager(routeState, locationKey)

  return (
    <WorkspaceMediaContext.Provider value={manager}>
      {children}
    </WorkspaceMediaContext.Provider>
  )
}

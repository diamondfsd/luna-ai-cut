import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineSettingsStore, useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { toast } from 'sonner'
import { useProjectMediaMatchDialogStore } from '@freecut/shared/state/project-media-match-dialog'
import {
  getProjectMediaMatchSuggestion,
  isProjectMatchableVisual,
} from '../utils/project-media-match'
import { commitProjectMetadataChange } from '../utils/project-metadata-history'

interface ProjectMediaMatchDialogProps {
  projectId: string
}

export function ProjectMediaMatchDialog({ projectId }: ProjectMediaMatchDialogProps) {
  const { t } = useTranslation()
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const mediaLoading = useMediaLibraryStore((state) => state.isLoading)
  const currentProject = useProjectStore((state) => state.currentProject)
  const updateProject = useProjectStore((state) => state.updateProject)
  const markDirty = useTimelineStore((state) => state.markDirty)
  const setFps = useTimelineSettingsStore((state) => state.setFps)
  const open = useProjectMediaMatchDialogStore((state) => state.isOpen)
  const pendingProjectId = useProjectMediaMatchDialogStore((state) => state.projectId)
  const pendingCandidate = useProjectMediaMatchDialogStore((state) => state.candidate)
  const resolveProjectMediaMatch = useProjectMediaMatchDialogStore(
    (state) => state.resolveProjectMediaMatch,
  )
  const requestProjectMediaMatch = useProjectMediaMatchDialogStore(
    (state) => state.requestProjectMediaMatch,
  )
  const markProjectMediaMatchHandled = useProjectMediaMatchDialogStore(
    (state) => state.markProjectMediaMatchHandled,
  )
  const hasHandledProjectMediaMatch = useProjectMediaMatchDialogStore(
    (state) => state.hasHandledProjectMediaMatch,
  )

  const [isApplying, setIsApplying] = useState(false)
  const initializedRef = useRef(false)
  const seenVisualIdsRef = useRef<Set<string>>(new Set())
  const awaitingAutoMatchRef = useRef(false)

  useEffect(() => {
    initializedRef.current = false
    awaitingAutoMatchRef.current = false
    seenVisualIdsRef.current = new Set()
    setIsApplying(false)
  }, [projectId])

  useEffect(() => {
    if (mediaLoading || !currentProject) {
      return
    }

    const visualItems = mediaItems.filter(isProjectMatchableVisual)

    if (!initializedRef.current) {
      initializedRef.current = true
      seenVisualIdsRef.current = new Set(visualItems.map((item) => item.id))
      if (visualItems.length > 0) {
        markProjectMediaMatchHandled(projectId)
      }
      return
    }

    const newVisuals = visualItems.filter((item) => !seenVisualIdsRef.current.has(item.id))

    for (const item of visualItems) {
      seenVisualIdsRef.current.add(item.id)
    }

    if (awaitingAutoMatchRef.current || hasHandledProjectMediaMatch(projectId)) {
      return
    }

    if (newVisuals.length === 0) {
      return
    }

    const firstVisual = [...newVisuals].sort((left, right) => left.createdAt - right.createdAt)[0]
    if (!firstVisual) {
      return
    }

    awaitingAutoMatchRef.current = true
    void requestProjectMediaMatch(projectId, {
      fileName: firstVisual.fileName,
      width: firstVisual.width,
      height: firstVisual.height,
      fps: firstVisual.mimeType.startsWith('video/') ? firstVisual.fps : undefined,
    }).finally(() => {
      awaitingAutoMatchRef.current = false
    })
  }, [
    currentProject,
    hasHandledProjectMediaMatch,
    markProjectMediaMatchHandled,
    mediaItems,
    mediaLoading,
    projectId,
    requestProjectMediaMatch,
  ])

  const suggestion = useMemo(() => {
    if (!currentProject || !pendingCandidate || pendingProjectId !== projectId) {
      return null
    }

    return getProjectMediaMatchSuggestion(currentProject.metadata, pendingCandidate)
  }, [currentProject, pendingCandidate, pendingProjectId, projectId])

  const applyMatch = useCallback(
    async () => {
      if (!currentProject || !pendingCandidate || !suggestion) {
        resolveProjectMediaMatch('keep-current')
        return
      }

      const choice = suggestion.fpsDiffers ? 'match-both' : 'size-only'

      const updates: {
        width?: number
        height?: number
        fps?: number
      } = {}

      if (suggestion.sizeDiffers) {
        updates.width = suggestion.width
        updates.height = suggestion.height
      }

      if (suggestion.fpsDiffers) {
        updates.fps = suggestion.fps
      }

      if (Object.keys(updates).length === 0) {
        resolveProjectMediaMatch('keep-current')
        return
      }

      setIsApplying(true)

      try {
        await commitProjectMetadataChange({
          project: currentProject,
          updates,
          command: {
            type: 'UPDATE_PROJECT_METADATA',
            payload: {
              fields: Object.keys(updates),
              operation: choice,
            },
          },
          updateProject,
          markDirty,
          onApplied: (updatedProject) => {
            if (updates.fps !== undefined) {
              setFps(updatedProject.metadata.fps)
            }
          },
        })
        resolveProjectMediaMatch(choice)
      } catch (error) {
        toast.error(t('editor.projectMediaMatch.updateFailed'), {
          description:
            error instanceof Error ? error.message : t('editor.projectMediaMatch.tryAgain'),
        })
        resolveProjectMediaMatch('keep-current')
      } finally {
        setIsApplying(false)
      }
    },
    [
      currentProject,
      markDirty,
      pendingCandidate,
      resolveProjectMediaMatch,
      setFps,
      suggestion,
      updateProject,
      t,
    ],
  )

  useEffect(() => {
    if (!open || pendingProjectId !== projectId || !suggestion || isApplying) return
    if (!suggestion.hasChanges) {
      resolveProjectMediaMatch('keep-current')
      return
    }
    void applyMatch()
  }, [applyMatch, isApplying, open, pendingProjectId, projectId, resolveProjectMediaMatch, suggestion])

  return null
}

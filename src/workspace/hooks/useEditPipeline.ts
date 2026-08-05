import { useCallback, useState } from 'react'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { createDefaultPipeline, mergePipeline } from '../shared/editPipeline'
import { collectHistoryMaskPaths, createEditHistory, mapHistoryPipelines, pushHistory, resetHistory, undoHistory, redoHistory } from '../shared/editHistory'
import type { EditHistory, HistoryGroup } from '../shared/editHistory'

export function useEditPipeline() {
  const [history, setHistory] = useState<EditHistory>(() => createEditHistory(createDefaultPipeline()))

  const pipeline = history.present
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    setHistory(undoHistory)
  }, [])

  const redo = useCallback(() => {
    setHistory(redoHistory)
  }, [])

  const commitPatch = useCallback((patch: PipelinePatch, group?: HistoryGroup) => {
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch), group))
  }, [])

  const commitUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline, group?: HistoryGroup) => {
    setHistory((current) => pushHistory(current, update(current.present), group))
  }, [])

  const applySystemUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline) => {
    setHistory((current) => mapHistoryPipelines(current, update))
  }, [])

  const resetPipeline = useCallback((nextPipeline?: EditPipeline) => {
    setHistory((current) => resetHistory(current, nextPipeline ?? createDefaultPipeline()))
  }, [])

  const initializePipeline = useCallback((initial: EditPipeline) => {
    setHistory(createEditHistory(initial))
  }, [])

  return {
    pipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    commitUpdate,
    applySystemUpdate,
    retainedMaskPaths: collectHistoryMaskPaths(history),
    resetPipeline,
    initializePipeline,
    setHistory,
  }
}

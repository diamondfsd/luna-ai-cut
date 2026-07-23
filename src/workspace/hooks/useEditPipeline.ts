import { useCallback, useState } from 'react'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { createDefaultPipeline, mergePipeline } from '../shared/editPipeline'
import { createEditHistory, pushHistory, resetHistory, undoHistory, redoHistory } from '../shared/editHistory'
import type { EditHistory } from '../shared/editHistory'

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

  const commitPatch = useCallback((patch: PipelinePatch) => {
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch)))
  }, [])

  const resetPipeline = useCallback(() => {
    setHistory((current) => resetHistory(current, createDefaultPipeline()))
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
    resetPipeline,
    initializePipeline,
    setHistory,
  }
}

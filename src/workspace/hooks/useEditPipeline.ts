import { useCallback, useState } from 'react'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { createDefaultPipeline, mergePipeline } from '../shared/editPipeline'
import { collectHistoryMaskPaths, createEditHistory, mapHistoryPipelines, pushHistory, resetHistory, undoHistory, redoHistory } from '../shared/editHistory'
import type { EditHistory, HistoryGroup } from '../shared/editHistory'

export function useEditPipeline() {
  const [history, setHistory] = useState<EditHistory>(() => createEditHistory(createDefaultPipeline()))
  const [previewDraft, setPreviewDraft] = useState<EditPipeline | null>(null)

  const pipeline = history.present
  const previewPipeline = previewDraft ?? pipeline
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    setPreviewDraft(null)
    setHistory(undoHistory)
  }, [])

  const redo = useCallback(() => {
    setPreviewDraft(null)
    setHistory(redoHistory)
  }, [])

  const commitPatch = useCallback((patch: PipelinePatch, group?: HistoryGroup) => {
    setPreviewDraft(null)
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch), group))
  }, [])

  const commitUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline, group?: HistoryGroup) => {
    setPreviewDraft(null)
    setHistory((current) => pushHistory(current, update(current.present), group))
  }, [])

  const applySystemUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline) => {
    setPreviewDraft(null)
    setHistory((current) => mapHistoryPipelines(current, update))
  }, [])

  const resetPipeline = useCallback((nextPipeline?: EditPipeline) => {
    setPreviewDraft(null)
    setHistory((current) => resetHistory(current, nextPipeline ?? createDefaultPipeline()))
  }, [])

  const initializePipeline = useCallback((initial: EditPipeline) => {
    setPreviewDraft(null)
    setHistory(createEditHistory(initial))
  }, [])

  const updatePreview = useCallback((update: (pipeline: EditPipeline) => EditPipeline) => {
    setPreviewDraft((current) => update(current ?? history.present))
  }, [history.present])

  const clearPreview = useCallback(() => {
    setPreviewDraft(null)
  }, [])

  return {
    pipeline,
    previewPipeline,
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
    updatePreview,
    clearPreview,
    setHistory,
  }
}

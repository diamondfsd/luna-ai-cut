import { useCallback, useRef, useState } from 'react'
import { logger } from '../../lib/rendererLogger'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { createDefaultPipeline, mergePipeline } from '../shared/editPipeline'
import { collectHistoryMaskPaths, createEditHistory, mapHistoryPipelines, pushHistory, resetHistory, undoHistory, redoHistory } from '../shared/editHistory'
import type { EditHistory, HistoryGroup } from '../shared/editHistory'

function summarizePipelineColor(pipeline: EditPipeline): Record<string, number | string | null> {
  return {
    exposure: pipeline.color.exposure,
    brightness: pipeline.color.brightness,
    contrast: pipeline.color.contrast,
    saturation: pipeline.color.saturation,
    vibrance: pipeline.color.vibrance,
    temperature: pipeline.color.temperature,
    tint: pipeline.color.tint,
    activeRestoreLut: pipeline.logRestore.activeId,
  }
}

export function useEditPipeline() {
  const [history, setHistory] = useState<EditHistory>(() => createEditHistory(createDefaultPipeline()))
  const [previewDraft, setPreviewDraft] = useState<EditPipeline | null>(null)

  const pipeline = history.present
  const previewPipeline = previewDraft ?? pipeline
  const pipelineRef = useRef(pipeline)
  const previewDraftRef = useRef<EditPipeline | null>(previewDraft)
  const previewPipelineRef = useRef(previewPipeline)
  const previewUpdateSequenceRef = useRef(0)
  pipelineRef.current = pipeline
  previewDraftRef.current = previewDraft
  previewPipelineRef.current = previewPipeline
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'undo',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory(undoHistory)
  }, [])

  const redo = useCallback(() => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'redo',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory(redoHistory)
  }, [])

  const commitPatch = useCallback((patch: PipelinePatch, group?: HistoryGroup) => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'commitPatch',
      patch,
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
      group,
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch), group))
  }, [])

  const commitUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline, group?: HistoryGroup) => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'commitUpdate',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
      group,
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory((current) => pushHistory(current, update(current.present), group))
  }, [])

  const applySystemUpdate = useCallback((update: (pipeline: EditPipeline) => EditPipeline) => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'applySystemUpdate',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory((current) => mapHistoryPipelines(current, update))
  }, [])

  const resetPipeline = useCallback((nextPipeline?: EditPipeline) => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'resetPipeline',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
      nextColor: nextPipeline ? summarizePipelineColor(nextPipeline) : null,
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory((current) => resetHistory(current, nextPipeline ?? createDefaultPipeline()))
  }, [])

  const initializePipeline = useCallback((initial: EditPipeline) => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'initializePipeline',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
      initialColor: summarizePipelineColor(initial),
    })
    previewDraftRef.current = null
    setPreviewDraft(null)
    setHistory(createEditHistory(initial))
  }, [])

  const updatePreview = useCallback((update: (pipeline: EditPipeline) => EditPipeline) => {
    const sequence = ++previewUpdateSequenceRef.current
    const hasDraft = previewDraftRef.current !== null
    const base = previewDraftRef.current ?? pipelineRef.current
    const next = update(base)
    previewDraftRef.current = next
    previewPipelineRef.current = next
    logger.info('[PreviewDebug] preview state applied', {
      sequence,
      base: hasDraft ? 'draft' : 'pipeline',
      baseColor: summarizePipelineColor(base),
      nextColor: summarizePipelineColor(next),
    })
    setPreviewDraft(next)
  }, [])

  const clearPreview = useCallback(() => {
    logger.info('[PreviewDebug] edit pipeline action', {
      action: 'clearPreview',
      pipelineColor: summarizePipelineColor(pipelineRef.current),
      previewColor: summarizePipelineColor(previewPipelineRef.current),
    })
    previewDraftRef.current = null
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

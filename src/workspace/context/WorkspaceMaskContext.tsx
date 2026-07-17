import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { toast } from '../../ui'
import { isImagePath } from '../../lib/fileUtils'
import { automaticSegmentationTarget, SEGMENTATION_MODELS, SAM_MODELS, type AutomaticSegmentationTargetId, type SegmentationModelId } from '../../shared/segmentationModels'
import type { WorkspaceSegmentationProgress } from '../../shared/types/api'
import { useWorkspaceEdit } from './WorkspaceEditContext'
import { useWorkspaceMedia } from './WorkspaceMediaContext'
import { createDefaultPipeline, type ColorMaskLayer } from '../shared/editPipeline'
import { createMaskOperation, isMatchingMaskOperation, isMatchingSegmentationRequest, type MaskOperation } from '../mask/maskOperationIdentity'
import { modelForAutomaticSelection } from '../mask/maskModelMode'
import { mergeCompletedColorMaskLayer, moveColorMaskLayer } from '../color/colorMaskLayerOperations'

export type MaskBrushMode = 'paint' | 'erase'
export type { SegmentationModelId } from '../../shared/segmentationModels'

export interface SegmentationPerformance {
  modelLoadMs: number
  imagePrepareMs: number
  inferenceMs: number
  totalMs: number
}

interface WorkspaceMaskValue {
  available: boolean
  editing: boolean
  setEditing: (value: boolean) => void
  brushMode: MaskBrushMode
  setBrushMode: (value: MaskBrushMode) => void
  brushSize: number
  setBrushSize: (value: number) => void
  showOverlay: boolean
  setShowOverlay: (value: boolean) => void
  maskData: Uint8Array | null
  maskSize: { width: number; height: number } | null
  busy: boolean
  semanticPicking: boolean
  setSemanticPicking: (value: boolean) => void
  segmentationModel: SegmentationModelId
  setSegmentationModel: (value: SegmentationModelId) => void
  lastSegmentationPerformance: SegmentationPerformance | null
  segmentationProgress: WorkspaceSegmentationProgress | null
  segmentationError: string | null
  clearSegmentationError: () => void
  cancelSegmentation: () => void
  activeLayerId: string | null
  activeMask: ColorMaskLayer | null
  setActiveLayerId: (id: string | null) => void
  createMask: () => void
  updateLayer: (id: string, patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'inverted' | 'blendMode' | 'color'>>) => void
  updateActiveLayer: (patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => void
  duplicateLayer: (id: string) => void
  removeLayer: (id: string) => void
  moveLayer: (id: string, direction: -1 | 1) => void
  moveActiveLayer: (direction: -1 | 1) => void
  commitMask: (data: Uint8Array) => Promise<void>
  updateMaskSettings: (patch: { opacity?: number; inverted?: boolean; feather?: number }) => void
  updateGroupedMaskSettings: (patch: { opacity?: number; feather?: number }, groupKey: string, finalize?: boolean) => void
  removeMask: () => Promise<void>
  generateSemanticMask: (point?: { x: number; y: number }, targetId?: AutomaticSegmentationTargetId) => Promise<void>
}

const WorkspaceMaskContext = createContext<WorkspaceMaskValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceMask(): WorkspaceMaskValue {
  const value = useContext(WorkspaceMaskContext)
  if (!value) throw new Error('useWorkspaceMask must be used within WorkspaceMaskProvider')
  return value
}

function workingMaskSize(width: number, height: number): { width: number; height: number } {
  const maxSide = 512
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function hasUsableAutomaticMask(data: Uint8Array): boolean {
  const requiredPixels = Math.max(16, Math.floor(data.length * 0.0005))
  let selectedPixels = 0
  for (const value of data) {
    if (value >= 128 && ++selectedPixels >= requiredPixels) return true
  }
  return false
}

export function WorkspaceMaskProvider({ children, active }: { children: ReactNode; active: boolean }) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const { canUndo, canRedo, undo, redo } = edit
  const [editing, setEditing] = useState(false)
  const [brushMode, setBrushMode] = useState<MaskBrushMode>('paint')
  const [brushSize, setBrushSize] = useState(36)
  const [showOverlay, setShowOverlay] = useState(true)
  const [maskData, setMaskData] = useState<Uint8Array | null>(null)
  const [maskSize, setMaskSize] = useState<{ width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [semanticPicking, setSemanticPicking] = useState(false)
  const [lastSegmentationPerformance, setLastSegmentationPerformance] = useState<SegmentationPerformance | null>(null)
  const [segmentationProgress, setSegmentationProgress] = useState<WorkspaceSegmentationProgress | null>(null)
  const [segmentationError, setSegmentationError] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [segmentationModel, setSegmentationModelState] = useState<SegmentationModelId>(() => {
    const saved = localStorage.getItem('workspace_segmentation_model')
    const model = [...SEGMENTATION_MODELS, ...SAM_MODELS].find((item) => item.id === saved)
    return model?.id ?? 'segformer-b0-ade20k'
  })
  const available = active && Boolean(media.currentProject && media.activeMedia?.path && isImagePath(media.activeMedia.path))
  const activeMask = edit.pipeline.colorMasks.find((layer) => layer.id === activeLayerId) ?? null
  const activeMaskPath = activeMask?.path
  const activeMediaId = media.activeMedia?.id
  const activeMediaPath = media.activeMedia?.path
  const projectId = media.currentProject?.id
  const operationGenerationRef = useRef(0)
  const activeOperationRef = useRef<MaskOperation | null>(null)
  const colorMasksRef = useRef(edit.pipeline.colorMasks)
  colorMasksRef.current = edit.pipeline.colorMasks
  const applySystemUpdate = edit.applySystemUpdate
  const currentIdentityRef = useRef({ projectId, assetId: activeMediaId, active })
  const previousIdentity = currentIdentityRef.current
  if (previousIdentity.projectId !== projectId || previousIdentity.assetId !== activeMediaId || previousIdentity.active !== active) {
    currentIdentityRef.current = { projectId, assetId: activeMediaId, active }
  }

  const cancelRequest = useCallback((operation: MaskOperation | null): void => {
    if (!operation?.requestId) return
    void window.luna.workspace.cancelSegmentation(operation.requestId).catch(() => undefined)
  }, [])

  const invalidateActiveOperation = useCallback((): void => {
    const operation = activeOperationRef.current
    operationGenerationRef.current += 1
    activeOperationRef.current = null
    setBusy(false)
    setSegmentationProgress(null)
    cancelRequest(operation)
  }, [cancelRequest])

  const beginOperation = useCallback((kind: MaskOperation['kind'], operationProjectId: string, assetId: string, requestId?: string): MaskOperation => {
    cancelRequest(activeOperationRef.current)
    const operation = createMaskOperation(operationGenerationRef.current, kind, operationProjectId, assetId, requestId)
    operationGenerationRef.current = operation.generation
    activeOperationRef.current = operation
    setBusy(true)
    return operation
  }, [cancelRequest])

  const isCurrentOperation = useCallback((operation: MaskOperation): boolean => {
    return isMatchingMaskOperation(activeOperationRef.current, operation, currentIdentityRef.current)
  }, [])

  const finishOperation = useCallback((operation: MaskOperation): void => {
    if (!isCurrentOperation(operation)) return
    activeOperationRef.current = null
    setBusy(false)
    setSegmentationProgress(null)
  }, [isCurrentOperation])

  const cancelSegmentation = useCallback((): void => {
    if (activeOperationRef.current?.kind === 'segmentation') invalidateActiveOperation()
  }, [invalidateActiveOperation])
  const clearSegmentationError = useCallback(() => setSegmentationError(null), [])

  useEffect(() => () => {
    const operation = activeOperationRef.current
    activeOperationRef.current = null
    cancelRequest(operation)
  }, [cancelRequest])

  useEffect(() => {
    if (activeLayerId && !edit.pipeline.colorMasks.some((layer) => layer.id === activeLayerId)) setActiveLayerId(null)
  }, [activeLayerId, activeMediaId, edit.pipeline.colorMasks])

  useEffect(() => {
    invalidateActiveOperation()
    setEditing(false)
    setActiveLayerId(null)
    setSemanticPicking(false)
    setShowOverlay(true)
    setBusy(false)
    setSegmentationProgress(null)
    setSegmentationError(null)
  }, [active, activeMediaId, invalidateActiveOperation, projectId])

  useEffect(() => window.luna.onWorkspaceSegmentationProgress((progress) => {
    const operation = activeOperationRef.current
    if (isMatchingSegmentationRequest(operation, progress.requestId) && operation && isCurrentOperation(operation)) {
      setSegmentationProgress(progress)
    }
  }), [isCurrentOperation])

  useEffect(() => {
    if (!editing) return
    const handleUndoRedo = (event: KeyboardEvent) => {
      if (busy) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return
      const shouldUndo = event.code === 'KeyZ' && !event.shiftKey
      const shouldRedo = (event.code === 'KeyZ' && event.shiftKey) || (event.code === 'KeyY' && event.ctrlKey)
      if (!shouldUndo && !shouldRedo) return
      event.preventDefault()
      event.stopPropagation()
      if (shouldUndo && canUndo) undo()
      if (shouldRedo && canRedo) redo()
    }
    window.addEventListener('keydown', handleUndoRedo, { capture: true })
    return () => window.removeEventListener('keydown', handleUndoRedo, { capture: true })
  }, [busy, canRedo, canUndo, editing, redo, undo])

  useEffect(() => {
    let canceled = false
    if (!available || !projectId || !activeMediaId || !activeMediaPath) {
      setEditing(false)
      setMaskData(null)
      setMaskSize(null)
      return
    }
    if (!activeMaskPath) {
      const operation = beginOperation('load', projectId, activeMediaId)
      window.luna.workspace.getMediaResolution(activeMediaPath).then((size) => {
        if (canceled || !isCurrentOperation(operation)) return
        const working = workingMaskSize(size.width, size.height)
        setMaskSize(working)
        setMaskData(new Uint8Array(working.width * working.height))
      }).catch(() => undefined).finally(() => finishOperation(operation))
      return () => {
        canceled = true
        finishOperation(operation)
      }
    }
    const operation = beginOperation('load', projectId, activeMediaId)
    const operationMaskId = activeMask?.id
    window.luna.workspace.loadColorMask(projectId, activeMaskPath).then((loaded) => {
      if (canceled || !isCurrentOperation(operation)) return
      setMaskSize({ width: loaded.width, height: loaded.height })
      setMaskData(new Uint8Array(loaded.bytes))
    }).catch(async () => {
      if (canceled || !isCurrentOperation(operation)) return
      if (operationMaskId) {
        applySystemUpdate((pipeline) => ({
          ...pipeline,
          colorMasks: pipeline.colorMasks.map((layer) => layer.id === operationMaskId
            ? { ...layer, enabled: false, loadError: 'missing-or-damaged' as const }
            : layer),
        }))
      }
      toast.error('蒙版文件不可用，可重新编辑这一层')
      try {
        const size = await window.luna.workspace.getMediaResolution(activeMediaPath)
        if (canceled || !isCurrentOperation(operation)) return
        const working = workingMaskSize(size.width, size.height)
        setMaskSize(working)
        setMaskData(new Uint8Array(working.width * working.height))
      } catch {
        // The layer remains disabled even when a blank rebuild canvas cannot be prepared.
      }
    }).finally(() => {
      finishOperation(operation)
    })
    return () => {
      canceled = true
      finishOperation(operation)
    }
  }, [activeMask?.id, activeMaskPath, activeMediaId, activeMediaPath, applySystemUpdate, available, beginOperation, finishOperation, isCurrentOperation, projectId])

  const commitMask = useCallback(async (data: Uint8Array) => {
    if (!media.currentProject || !media.activeMedia || !maskSize) {
      toast.error('请先在项目中打开一张图片')
      return
    }
    const operationProjectId = media.currentProject.id
    const operationAssetId = media.activeMedia.id
    const operationMaskSize = maskSize
    const operationMask = activeMask
    const operation = beginOperation('save', operationProjectId, operationAssetId)
    try {
      const saved = await window.luna.workspace.saveColorMask(
        operationProjectId,
        operationAssetId,
        operationMaskSize.width,
        operationMaskSize.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        operationMask?.feather ?? 2,
      )
      if (!isCurrentOperation(operation)) return
      setMaskData(new Uint8Array(data))
      const layerId = operationMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const layer: ColorMaskLayer = {
          path: saved.path,
          width: saved.width,
          height: saved.height,
          opacity: operationMask?.opacity ?? 1,
          inverted: operationMask?.inverted ?? false,
          feather: operationMask?.feather ?? 2,
          kind: operationMask?.kind ?? 'brush',
          classId: operationMask?.classId,
          className: operationMask?.className,
          targetId: operationMask?.targetId,
          modelId: operationMask?.modelId,
          id: layerId,
          name: operationMask?.name ?? `蒙版 ${colorMasksRef.current.length + 1}`,
          enabled: operationMask?.enabled ?? true,
          loadError: undefined,
          blendMode: operationMask?.blendMode ?? 'normal',
          color: operationMask?.color ?? createDefaultPipeline().color,
      }
      const nextLayers = mergeCompletedColorMaskLayer(colorMasksRef.current, operationMask?.id ?? null, layer)
      if (nextLayers === colorMasksRef.current) return
      edit.commitPatch({ colorMasks: nextLayers })
      setActiveLayerId(layerId)
    } catch (error) {
      if (isCurrentOperation(operation)) toast.error(error instanceof Error ? error.message : '保存蒙版失败')
    } finally {
      finishOperation(operation)
    }
  }, [activeMask, beginOperation, edit, finishOperation, isCurrentOperation, maskSize, media.activeMedia, media.currentProject])

  const updateMaskSettings = useCallback((patch: { opacity?: number; inverted?: boolean; feather?: number }) => {
    if (!activeMask) return
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === activeMask.id ? { ...layer, ...patch } : layer) })
  }, [activeMask, edit])

  const updateGroupedMaskSettings = useCallback((patch: { opacity?: number; feather?: number }, groupKey: string, finalize = false) => {
    if (!activeMask) return
    edit.commitPatch({
      colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === activeMask.id ? { ...layer, ...patch } : layer),
    }, { key: `mask:${activeMask.id}:${groupKey}`, finalize })
  }, [activeMask, edit])

  const updateLayer = useCallback((id: string, patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'inverted' | 'blendMode' | 'color'>>) => {
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === id ? { ...layer, ...patch } : layer) })
  }, [edit])

  const updateActiveLayer = useCallback((patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => {
    if (activeMask) updateLayer(activeMask.id, patch)
  }, [activeMask, updateLayer])

  const duplicateLayer = useCallback((id: string) => {
    const index = edit.pipeline.colorMasks.findIndex((layer) => layer.id === id)
    if (index < 0) return
    const source = edit.pipeline.colorMasks[index]
    const copy: ColorMaskLayer = {
      ...structuredClone(source),
      id: `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${source.name} 副本`,
    }
    const next = [...edit.pipeline.colorMasks]
    next.splice(index + 1, 0, copy)
    edit.commitPatch({ colorMasks: next })
    setActiveLayerId(copy.id)
  }, [edit])

  const removeLayer = useCallback((id: string) => {
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.filter((layer) => layer.id !== id) })
    if (activeLayerId === id) setActiveLayerId(null)
  }, [activeLayerId, edit])

  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    const next = moveColorMaskLayer(edit.pipeline.colorMasks, id, direction)
    if (next !== edit.pipeline.colorMasks) edit.commitPatch({ colorMasks: next })
  }, [edit])

  const moveActiveLayer = useCallback((direction: -1 | 1) => {
    if (activeMask) moveLayer(activeMask.id, direction)
  }, [activeMask, moveLayer])

  const createMask = useCallback(() => {
    setActiveLayerId(null)
    setEditing(true)
    setSemanticPicking(false)
    if (maskSize) setMaskData(new Uint8Array(maskSize.width * maskSize.height))
  }, [maskSize])

  const removeMask = useCallback(async () => {
    if (maskSize) setMaskData(new Uint8Array(maskSize.width * maskSize.height))
    if (!activeMask) return
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.filter((layer) => layer.id !== activeMask.id) })
    setActiveLayerId(null)
    setEditing(false)
  }, [activeMask, edit, maskSize])

  const generateSemanticMask = useCallback(async (point?: { x: number; y: number }, targetId?: AutomaticSegmentationTargetId) => {
    if (!media.activeMedia || !media.currentProject || !maskSize) return
    const operationProjectId = media.currentProject.id
    const operationAssetId = media.activeMedia.id
    const operationMediaPath = media.activeMedia.path
    const operationMask = activeMask
    const requestId = crypto.randomUUID()
    const operation = beginOperation('segmentation', operationProjectId, operationAssetId, requestId)
    setSegmentationError(null)
    setSegmentationProgress({ requestId, phase: 'model', label: '正在准备模型', percent: null })
    try {
      const target = targetId ? automaticSegmentationTarget(targetId) : undefined
      const modelId = target?.modelId ?? modelForAutomaticSelection(segmentationModel)
      const result = await window.luna.workspace.segmentImage({ requestId, filePath: operationMediaPath, point, modelId, targetId, targetClassId: target?.classId })
      if (result.requestId !== requestId || !isCurrentOperation(operation)) return
      setLastSegmentationPerformance(result.performance)
      const data = new Uint8Array(result.bytes)
      if (targetId !== undefined && !hasUsableAutomaticMask(data)) {
        setSegmentationError(`未找到${result.className}，可使用画笔手动选择`)
        return
      }
      const saved = await window.luna.workspace.saveColorMask(
        operationProjectId,
        operationAssetId,
        result.width,
        result.height,
        result.bytes,
        operationMask?.feather ?? 2,
      )
      if (!isCurrentOperation(operation)) return
      setMaskSize({ width: result.width, height: result.height })
      setMaskData(data)
      const layerId = operationMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const layer: ColorMaskLayer = {
          path: saved.path,
          width: saved.width,
          height: saved.height,
          opacity: operationMask?.opacity ?? 1,
          inverted: operationMask?.inverted ?? false,
          feather: operationMask?.feather ?? 2,
          kind: 'semantic',
          classId: result.classId,
          className: result.className,
          targetId: result.targetId,
          modelId: result.modelId,
          id: layerId,
          name: operationMask?.name ?? result.className ?? `蒙版 ${colorMasksRef.current.length + 1}`,
          enabled: operationMask?.enabled ?? true,
          loadError: undefined,
          blendMode: operationMask?.blendMode ?? 'normal',
          color: operationMask?.color ?? createDefaultPipeline().color,
      }
      const nextLayers = mergeCompletedColorMaskLayer(colorMasksRef.current, operationMask?.id ?? null, layer)
      if (nextLayers === colorMasksRef.current) return
      edit.commitPatch({ colorMasks: nextLayers })
      setActiveLayerId(layerId)
    } catch (error) {
      if (isCurrentOperation(operation)) setSegmentationError(error instanceof Error ? error.message : '自动选择失败，请重试')
    } finally {
      finishOperation(operation)
    }
  }, [activeMask, beginOperation, edit, finishOperation, isCurrentOperation, maskSize, media.activeMedia, media.currentProject, segmentationModel])

  const setSegmentationModel = useCallback((model: SegmentationModelId) => {
    setSegmentationModelState(model)
    localStorage.setItem('workspace_segmentation_model', model)
  }, [])

  const value = useMemo<WorkspaceMaskValue>(() => ({
    available,
    editing,
    setEditing,
    brushMode,
    setBrushMode,
    brushSize,
    setBrushSize,
    showOverlay,
    setShowOverlay,
    maskData,
    maskSize,
    busy,
    semanticPicking,
    setSemanticPicking,
    segmentationModel,
    setSegmentationModel,
    lastSegmentationPerformance,
    segmentationProgress,
    segmentationError,
    clearSegmentationError,
    cancelSegmentation,
    activeLayerId,
    activeMask,
    setActiveLayerId,
    createMask,
    updateLayer,
    updateActiveLayer,
    duplicateLayer,
    removeLayer,
    moveLayer,
    moveActiveLayer,
    commitMask,
    updateMaskSettings,
    updateGroupedMaskSettings,
    removeMask,
    generateSemanticMask,
  }), [activeLayerId, activeMask, available, brushMode, brushSize, busy, cancelSegmentation, clearSegmentationError, commitMask, createMask, duplicateLayer, editing, generateSemanticMask, lastSegmentationPerformance, maskData, maskSize, moveActiveLayer, moveLayer, removeLayer, removeMask, segmentationError, segmentationModel, segmentationProgress, semanticPicking, setSegmentationModel, showOverlay, updateActiveLayer, updateGroupedMaskSettings, updateLayer, updateMaskSettings])

  return <WorkspaceMaskContext.Provider value={value}>{children}</WorkspaceMaskContext.Provider>
}

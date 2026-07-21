import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from '../../ui'
import { logger } from '../../lib/rendererLogger'
import { automaticSegmentationTarget, SEGMENTATION_MODELS, SAM_MODELS, type AutomaticSegmentationTargetId, type SegmentationModelId } from '../../shared/segmentationModels'
import type { WorkspaceMaskTrackingProgress, WorkspaceSegmentationProgress } from '../../shared/types/api'
import { useWorkspaceEdit } from './WorkspaceEditContext'
import { useWorkspaceMedia } from './WorkspaceMediaContext'
import { createDefaultPipeline, type ColorMaskLayer } from '../shared/editPipeline'
import { createMaskOperation, isMatchingMaskOperation, isMatchingSegmentationRequest, type MaskOperation } from '../mask/maskOperationIdentity'
import { modelForAutomaticSelection } from '../mask/maskModelMode'
import { mergeCompletedColorMaskLayer, moveColorMaskLayer } from '../color/colorMaskLayerOperations'
import { applyMaskSelectionOperation, hasUsableMask, resampleMask, type MaskSelectionOperation } from '../mask/maskSelectionOperations'
import type { MaskManualTool, SegmentationPerformance, WorkspaceMaskValue } from './WorkspaceMaskContextTypes'
import { rebuildMaskCache, useMaskComponentPersistence } from './useMaskComponentPersistence'
import { useMaskShortcuts } from './useMaskShortcuts'
import { MASK_TRACK_ALGORITHM_VERSION, maskTrackTransformAt, mergeMaskTrackSegment } from '../mask/maskTrack'
export type { SegmentationModelId } from '../../shared/segmentationModels'
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
export function WorkspaceMaskProvider({ children, active }: { children: ReactNode; active: boolean }) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const { canUndo, canRedo, undo, redo } = edit
  const videoFrameTimeRef = useRef(0)
  const [editing, setEditing] = useState(false)
  const [selectionOperation, setSelectionOperation] = useState<MaskSelectionOperation>('replace')
  const [manualTool, setManualTool] = useState<MaskManualTool>('move')
  const [brushSize, setBrushSize] = useState(36)
  const [brushFeather, setBrushFeather] = useState(25)
  const [showOverlay, setShowOverlay] = useState(true)
  const [maskData, setMaskData] = useState<Uint8Array | null>(null)
  const [maskSize, setMaskSize] = useState<{ width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [semanticPicking, setSemanticPicking] = useState(false)
  const [lastSegmentationPerformance, setLastSegmentationPerformance] = useState<SegmentationPerformance | null>(null)
  const [segmentationProgress, setSegmentationProgress] = useState<WorkspaceSegmentationProgress | null>(null)
  const [segmentationError, setSegmentationError] = useState<string | null>(null)
  const [maskTrackingBusy, setMaskTrackingBusy] = useState(false)
  const [maskTrackingProgress, setMaskTrackingProgress] = useState<WorkspaceMaskTrackingProgress | null>(null)
  const [maskTrackingError, setMaskTrackingError] = useState<string | null>(null)
  const [maskTrackingStoppedReason, setMaskTrackingStoppedReason] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [segmentationModel, setSegmentationModelState] = useState<SegmentationModelId>(() => {
    const saved = localStorage.getItem('workspace_segmentation_model')
    const model = [...SEGMENTATION_MODELS, ...SAM_MODELS].find((item) => item.id === saved)
    return model?.id ?? 'rmbg-1.4'
  })
  const available = active && Boolean(media.currentProject && media.activeMedia?.path)
  const activeMask = edit.pipeline.colorMasks.find((layer) => layer.id === activeLayerId) ?? null
  const activeMaskPath = activeMask?.path
  const activeMediaId = media.activeMedia?.id
  const activeMediaPath = media.activeMedia?.path
  const projectId = media.currentProject?.id
  const operationGenerationRef = useRef(0)
  const activeOperationRef = useRef<MaskOperation | null>(null)
  const trackingRequestRef = useRef<string | null>(null)
  const automaticTrackingPromiseRef = useRef<Promise<void> | null>(null)
  const autoTrackingGenerationRef = useRef(0)
  const autoTrackingRevisionRef = useRef<string | null>(null)
  const autoTrackingAnchorRef = useRef<{ revision: string; time: number } | null>(null)
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
  const cancelMaskTracking = useCallback((): void => {
    autoTrackingGenerationRef.current += 1
    const requestId = trackingRequestRef.current
    trackingRequestRef.current = null
    setMaskTrackingBusy(false)
    setMaskTrackingProgress(null)
    if (requestId) void window.luna.workspace.cancelMaskTracking(requestId).catch(() => undefined)
  }, [])
  const setVideoFrameTime = useCallback((value: number): void => { videoFrameTimeRef.current = Number.isFinite(value) ? Math.max(0, value) : 0 }, [])
  const clearSegmentationError = useCallback(() => setSegmentationError(null), [])
  const commitLayers = useCallback((layers: ColorMaskLayer[]) => edit.commitPatch({ colorMasks: layers }), [edit])
  const componentPersistence = useMaskComponentPersistence({
    activeMask,
    maskSize,
    projectId: projectId ?? null,
    assetId: activeMediaId ?? null,
    colorMasksRef,
    beginOperation,
    finishOperation,
    isCurrentOperation,
    commitLayers,
    setMaskData,
    setActiveLayerId,
  })
  const { setActiveComponentId } = componentPersistence

  useEffect(() => () => {
    const operation = activeOperationRef.current
    activeOperationRef.current = null
    cancelRequest(operation)
    const trackingRequestId = trackingRequestRef.current
    trackingRequestRef.current = null
    if (trackingRequestId) void window.luna.workspace.cancelMaskTracking(trackingRequestId).catch(() => undefined)
  }, [cancelRequest])

  useEffect(() => {
    if (activeLayerId && !edit.pipeline.colorMasks.some((layer) => layer.id === activeLayerId)) setActiveLayerId(null)
  }, [activeLayerId, activeMediaId, edit.pipeline.colorMasks])

  useEffect(() => {
    invalidateActiveOperation()
    setEditing(false)
    setManualTool('move')
    setActiveLayerId(null)
    setActiveComponentId(null)
    setSemanticPicking(false)
    setSelectionOperation('replace')
    setShowOverlay(true)
    setBusy(false)
    setSegmentationProgress(null)
    setSegmentationError(null)
    cancelMaskTracking()
    setMaskTrackingError(null)
    setMaskTrackingStoppedReason(null)
    autoTrackingRevisionRef.current = null
    autoTrackingAnchorRef.current = null
    videoFrameTimeRef.current = 0
  }, [active, activeMediaId, cancelMaskTracking, invalidateActiveOperation, projectId, setActiveComponentId])

  useEffect(() => {
    if (!editing) setManualTool('move')
  }, [editing])

  useEffect(() => window.luna.onWorkspaceSegmentationProgress((progress) => {
    const operation = activeOperationRef.current
    if (isMatchingSegmentationRequest(operation, progress.requestId) && operation && isCurrentOperation(operation)) {
      setSegmentationProgress(progress)
    }
  }), [isCurrentOperation])

  useEffect(() => window.luna.onWorkspaceMaskTrackingProgress((progress) => {
    if (trackingRequestRef.current === progress.requestId) setMaskTrackingProgress(progress)
  }), [])

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

  useMaskShortcuts({
    editing, busy, semanticPicking,
    cancelSegmentation,
    setSemanticPicking, setManualTool, setShowOverlay, setBrushSize, setBrushFeather,
  })

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
      try {
        const size = await window.luna.workspace.getMediaResolution(activeMediaPath)
        if (canceled || !isCurrentOperation(operation)) return
        const working = workingMaskSize(size.width, size.height)
        if (activeMask?.components?.length) {
          const rebuilt = await rebuildMaskCache(projectId, activeMediaId, working.width, working.height, activeMask.components, activeMask.feather)
          if (canceled || !isCurrentOperation(operation)) return
          setMaskSize({ width: rebuilt.width, height: rebuilt.height })
          setMaskData(rebuilt.data)
          applySystemUpdate((pipeline) => ({
            ...pipeline,
            colorMasks: pipeline.colorMasks.map((layer) => layer.id === operationMaskId
              ? { ...layer, path: rebuilt.path, width: rebuilt.width, height: rebuilt.height, enabled: true, loadError: undefined, components: rebuilt.components }
              : layer),
          }))
          return
        }
        throw new Error('没有可恢复的蒙版组件')
      } catch {
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
        } catch { /* The damaged layer remains disabled. */ }
      }
    }).finally(() => {
      finishOperation(operation)
    })
    return () => {
      canceled = true
      finishOperation(operation)
    }
  }, [activeMask?.components, activeMask?.feather, activeMask?.id, activeMaskPath, activeMediaId, activeMediaPath, applySystemUpdate, available, beginOperation, finishOperation, isCurrentOperation, projectId])

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
    setManualTool('move')
    setSemanticPicking(false)
    setSelectionOperation('replace')
    if (maskSize) setMaskData(new Uint8Array(maskSize.width * maskSize.height))
  }, [maskSize])

  const removeMask = useCallback(async () => {
    if (maskSize) setMaskData(new Uint8Array(maskSize.width * maskSize.height))
    if (!activeMask) return
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.filter((layer) => layer.id !== activeMask.id) })
    setActiveLayerId(null)
    setEditing(false)
  }, [activeMask, edit, maskSize])

  const generateSemanticMask = useCallback(async (point?: { x: number; y: number }, targetId?: AutomaticSegmentationTargetId, requestedModelId?: SegmentationModelId) => {
    if (!media.activeMedia || media.activeMedia.kind === 'video' || !media.currentProject || !maskSize) return
    const operationProjectId = media.currentProject.id
    const operationAssetId = media.activeMedia.id
    const operationMediaPath = media.activeMedia.path
    const operationMask = activeMask
    const operationSelectionMode = selectionOperation
    const operationBaseMask = maskData && maskSize
      ? resampleMask(maskData, maskSize.width, maskSize.height, maskSize.width, maskSize.height)
      : null
    const requestId = crypto.randomUUID()
    const operation = beginOperation('segmentation', operationProjectId, operationAssetId, requestId)
    setManualTool('move')
    logger.info('[Mask] 用户开始自动选择', { requestId, targetId, modelId: requestedModelId, assetId: operationAssetId })
    setSegmentationError(null)
    setSegmentationProgress({ requestId, phase: 'model', label: '正在准备模型', percent: null })
    try {
      const target = targetId ? automaticSegmentationTarget(targetId) : undefined
      const modelId = requestedModelId ?? target?.modelId ?? modelForAutomaticSelection(segmentationModel)
      const frameTime = undefined
      const result = await window.luna.workspace.segmentImage({ requestId, filePath: operationMediaPath, frameTime, point, modelId, targetId, targetClassId: target?.classId })
      if (result.requestId !== requestId || !isCurrentOperation(operation)) return
      setLastSegmentationPerformance(result.performance)
      const generatedData = new Uint8Array(result.bytes)
      if (targetId !== undefined && !hasUsableMask(generatedData)) {
        logger.warn('[Mask] 自动选择未找到有效区域', { requestId, targetId, modelId: result.modelId })
        setSegmentationError(`未找到${result.className}，可使用画笔手动选择`)
        return
      }
      const baseData = operationBaseMask && maskSize
        ? resampleMask(operationBaseMask, maskSize.width, maskSize.height, result.width, result.height)
        : new Uint8Array(result.width * result.height)
      const data = applyMaskSelectionOperation(baseData, generatedData, operationSelectionMode)
      const componentSaved = await window.luna.workspace.saveColorMask(
        operationProjectId,
        operationAssetId,
        result.width,
        result.height,
        result.bytes,
        0,
      )
      const saved = await window.luna.workspace.saveColorMask(
        operationProjectId,
        operationAssetId,
        result.width,
        result.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        operationMask?.feather ?? 2,
      )
      if (!isCurrentOperation(operation)) return
      setMaskSize({ width: result.width, height: result.height })
      setMaskData(data)
      const layerId = operationMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const component = {
        id: `component-${crypto.randomUUID()}`,
        type: 'raster' as const,
        operation: operationSelectionMode,
        enabled: true,
        inverted: false,
        path: componentSaved.path,
        width: componentSaved.width,
        height: componentSaved.height,
        dynamicSource: {
          kind: 'segmentation' as const,
          modelId: result.modelId,
          frameTime,
          targetId: result.targetId,
          classId: result.classId,
          className: result.className,
          point,
        },
      }
      const legacyComponents = operationMask?.path ? [{
        id: `component-base-${operationMask.id}`,
        type: 'raster' as const,
        operation: 'replace' as const,
        enabled: true,
        inverted: false,
        path: operationMask.path,
        width: operationMask.width,
        height: operationMask.height,
      }] : []
      const existingComponents = operationMask?.components ?? legacyComponents
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
          components: component.operation === 'replace' ? [component] : [...existingComponents, component],
      }
      const nextLayers = mergeCompletedColorMaskLayer(colorMasksRef.current, operationMask?.id ?? null, layer)
      if (nextLayers === colorMasksRef.current) return
      if (frameTime !== undefined) {
        autoTrackingAnchorRef.current = {
          revision: `${operationAssetId}:${layerId}:${layer.path}`,
          time: frameTime,
        }
      }
      edit.commitPatch({ colorMasks: nextLayers })
      setActiveLayerId(layerId)
      setActiveComponentId(component.id)
      logger.info('[Mask] 自动选择结果已应用', { requestId, targetId, modelId: result.modelId, layerId, performance: result.performance })
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动选择失败，请重试'
      if (isCurrentOperation(operation)) {
        logger.error('[Mask] 自动选择未应用', { requestId, targetId, modelId: requestedModelId, message })
        setSegmentationError(message)
      } else {
        logger.info('[Mask] 自动选择已取消或结果已过期', { requestId, targetId, modelId: requestedModelId, message })
      }
    } finally {
      finishOperation(operation)
    }
  }, [activeMask, beginOperation, edit, finishOperation, isCurrentOperation, maskData, maskSize, media.activeMedia, media.currentProject, segmentationModel, selectionOperation, setActiveComponentId])

  const setSegmentationModel = useCallback((model: SegmentationModelId) => {
    setSegmentationModelState(model)
    localStorage.setItem('workspace_segmentation_model', model)
  }, [])

  const startMaskTracking = useCallback(async (direction: 'forward' | 'backward', anchorOverride?: number): Promise<boolean> => {
    if (maskTrackingBusy || busy || !activeMask || !maskData || !maskSize || media.activeMedia?.kind !== 'video' || !projectId || !activeMediaId) return false
    const requestId = crypto.randomUUID()
    const operationLayerId = activeMask.id
    const operationAssetId = activeMediaId
    const anchorTime = anchorOverride ?? videoFrameTimeRef.current
    const compatibleTrack = activeMask.track?.algorithmVersion === MASK_TRACK_ALGORITHM_VERSION ? activeMask.track : undefined
    const initial = maskTrackTransformAt(compatibleTrack, anchorTime)
    const bytes = maskData.buffer.slice(maskData.byteOffset, maskData.byteOffset + maskData.byteLength)
    trackingRequestRef.current = requestId
    setMaskTrackingBusy(true)
    setMaskTrackingError(null)
    setMaskTrackingStoppedReason(null)
    setMaskTrackingProgress({ requestId, direction, percent: 0, time: anchorTime, confidence: 1 })
    logger.info('[MaskTrack] 自动追踪开始', { requestId, direction, anchorTime, layerId: operationLayerId, assetId: operationAssetId })
    try {
      const result = await window.luna.workspace.trackMask({
        requestId,
        filePath: media.activeMedia.path,
        direction,
        anchorTime,
        maskWidth: maskSize.width,
        maskHeight: maskSize.height,
        maskBytes: bytes,
        initialTransform: {
          translateX: initial.translateX,
          translateY: initial.translateY,
          scale: initial.scale,
          rotation: initial.rotation,
        },
      })
      if (trackingRequestRef.current !== requestId || currentIdentityRef.current.assetId !== operationAssetId) return false
      const currentLayer = colorMasksRef.current.find((layer) => layer.id === operationLayerId)
      if (!currentLayer) return false
      const compatibleCurrentTrack = currentLayer.track?.algorithmVersion === MASK_TRACK_ALGORITHM_VERSION ? currentLayer.track : undefined
      const track = mergeMaskTrackSegment(compatibleCurrentTrack, result.anchorTime, result.direction, result.keyframes)
      if (!track) throw new Error('追踪结果为空')
      edit.commitPatch({
        colorMasks: colorMasksRef.current.map((layer) => layer.id === operationLayerId ? { ...layer, track } : layer),
      })
      setMaskTrackingStoppedReason(result.stoppedReason ?? null)
      logger.info('[MaskTrack] 追踪结果已应用', { requestId, direction, keyframes: result.keyframes.length, completed: result.completed, stoppedReason: result.stoppedReason })
      return true
    } catch (error) {
      if (trackingRequestRef.current !== requestId) return false
      const message = error instanceof Error ? error.message : '蒙版追踪失败，请重试'
      setMaskTrackingError(message)
      logger.error('[MaskTrack] 追踪失败', { requestId, direction, message })
      return false
    } finally {
      if (trackingRequestRef.current === requestId) {
        trackingRequestRef.current = null
        setMaskTrackingBusy(false)
        setMaskTrackingProgress(null)
      }
    }
  }, [activeMask, activeMediaId, busy, edit, maskData, maskSize, maskTrackingBusy, media.activeMedia, projectId])

  const runAutomaticMaskTracking = useCallback((): Promise<void> => {
    if (automaticTrackingPromiseRef.current) return automaticTrackingPromiseRef.current
    if (media.activeMedia?.kind !== 'video' || busy || maskTrackingBusy || !activeMask || activeMask.track?.algorithmVersion === MASK_TRACK_ALGORITHM_VERSION || !activeMediaId || !maskData || !maskSize || !hasUsableMask(maskData)) return Promise.resolve()
    const revision = `${activeMediaId}:${activeMask.id}:${activeMask.path}`
    if (autoTrackingRevisionRef.current === revision) return Promise.resolve()
    autoTrackingRevisionRef.current = revision
    const generation = autoTrackingGenerationRef.current + 1
    autoTrackingGenerationRef.current = generation
    const requestedAnchor = autoTrackingAnchorRef.current
    const anchorTime = requestedAnchor?.revision === revision
      ? requestedAnchor.time
      : activeMask.track?.anchorTime ?? videoFrameTimeRef.current
    const promise = (async () => {
      await startMaskTracking('forward', anchorTime)
      if (autoTrackingGenerationRef.current !== generation) return
      await startMaskTracking('backward', anchorTime)
    })().finally(() => {
      if (automaticTrackingPromiseRef.current === promise) automaticTrackingPromiseRef.current = null
    })
    automaticTrackingPromiseRef.current = promise
    return promise
  }, [activeMask, activeMediaId, busy, maskData, maskSize, maskTrackingBusy, media.activeMedia?.kind, startMaskTracking])

  useEffect(() => { void runAutomaticMaskTracking() }, [runAutomaticMaskTracking])

  const prepareVideoMasksForExport = useCallback(async (): Promise<ColorMaskLayer[]> => {
    await runAutomaticMaskTracking()
    const layers = colorMasksRef.current
    if (media.activeMedia?.kind === 'video' && activeMask && maskData && hasUsableMask(maskData)) {
      const latest = layers.find((layer) => layer.id === activeMask.id)
      if (latest?.track?.algorithmVersion !== MASK_TRACK_ALGORITHM_VERSION) throw new Error(maskTrackingError ?? '视频蒙版尚未完成位置优化')
    }
    return layers
  }, [activeMask, maskData, maskTrackingError, media.activeMedia?.kind, runAutomaticMaskTracking])

  const value = useMemo<WorkspaceMaskValue>(() => ({
    available,
    setVideoFrameTime,
    editing,
    setEditing,
    selectionOperation,
    setSelectionOperation,
    manualTool,
    setManualTool,
    brushSize,
    setBrushSize,
    brushFeather,
    setBrushFeather,
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
    maskTrackingBusy,
    maskTrackingProgress,
    maskTrackingError,
    maskTrackingStoppedReason,
    prepareVideoMasksForExport,
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
    activeComponentId: componentPersistence.activeComponentId,
    activeComponent: componentPersistence.activeComponent,
    projectId: projectId ?? null,
    setActiveComponentId: componentPersistence.setActiveComponentId,
    commitMask: componentPersistence.commitMask,
    removeActiveComponent: componentPersistence.removeActiveComponent,
    duplicateActiveComponent: componentPersistence.duplicateActiveComponent,
    updateActiveComponent: componentPersistence.updateActiveComponent,
    updateMaskSettings,
    updateGroupedMaskSettings,
    removeMask,
    generateSemanticMask,
  }), [activeLayerId, activeMask, available, brushFeather, brushSize, busy, cancelSegmentation, clearSegmentationError, componentPersistence.activeComponent, componentPersistence.activeComponentId, componentPersistence.commitMask, componentPersistence.duplicateActiveComponent, componentPersistence.removeActiveComponent, componentPersistence.setActiveComponentId, componentPersistence.updateActiveComponent, createMask, duplicateLayer, editing, generateSemanticMask, lastSegmentationPerformance, manualTool, maskData, maskSize, maskTrackingBusy, maskTrackingError, maskTrackingProgress, maskTrackingStoppedReason, moveActiveLayer, moveLayer, prepareVideoMasksForExport, projectId, removeLayer, removeMask, segmentationError, segmentationModel, segmentationProgress, selectionOperation, semanticPicking, setSegmentationModel, setVideoFrameTime, showOverlay, updateActiveLayer, updateGroupedMaskSettings, updateLayer, updateMaskSettings])

  return <WorkspaceMaskContext.Provider value={value}>{children}</WorkspaceMaskContext.Provider>
}

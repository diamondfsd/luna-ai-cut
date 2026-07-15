import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { toast } from '../../ui'
import { isImagePath } from '../../lib/fileUtils'
import { SEGMENTATION_MODELS, SAM_MODELS, type SegmentationModelId } from '../../shared/segmentationModels'
import type { WorkspaceSegmentationProgress } from '../../shared/types/api'
import { useWorkspaceEdit } from './WorkspaceEditContext'
import { useWorkspaceMedia } from './WorkspaceMediaContext'
import { createDefaultPipeline, type ColorMaskLayer } from '../shared/editPipeline'

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
  activeLayerId: string | null
  activeMask: ColorMaskLayer | null
  setActiveLayerId: (id: string | null) => void
  createMask: () => void
  updateLayer: (id: string, patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => void
  updateActiveLayer: (patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => void
  duplicateLayer: (id: string) => void
  removeLayer: (id: string) => void
  moveActiveLayer: (direction: -1 | 1) => void
  commitMask: (data: Uint8Array) => Promise<void>
  updateMaskSettings: (patch: { opacity?: number; inverted?: boolean; feather?: number }) => void
  removeMask: () => Promise<void>
  generateSemanticMask: (point?: { x: number; y: number }) => Promise<void>
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

export function WorkspaceMaskProvider({ children }: { children: ReactNode }) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
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
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [segmentationModel, setSegmentationModelState] = useState<SegmentationModelId>(() => {
    const saved = localStorage.getItem('workspace_segmentation_model')
    const model = [...SEGMENTATION_MODELS, ...SAM_MODELS].find((item) => item.id === saved)
    return model?.id ?? 'segformer-b0-ade20k'
  })
  const available = Boolean(media.currentProject && media.activeMedia?.path && isImagePath(media.activeMedia.path))
  const activeMask = edit.pipeline.colorMasks.find((layer) => layer.id === activeLayerId) ?? null
  const activeMaskPath = activeMask?.path
  const activeMediaId = media.activeMedia?.id
  const activeMediaPath = media.activeMedia?.path
  const projectId = media.currentProject?.id

  useEffect(() => {
    if (activeLayerId && !edit.pipeline.colorMasks.some((layer) => layer.id === activeLayerId)) setActiveLayerId(null)
  }, [activeLayerId, activeMediaId, edit.pipeline.colorMasks])

  useEffect(() => window.luna.onWorkspaceSegmentationProgress(setSegmentationProgress), [])

  useEffect(() => {
    let canceled = false
    if (!available || !activeMediaPath) {
      setEditing(false)
      setMaskData(null)
      setMaskSize(null)
      return
    }
    if (!activeMaskPath || !projectId) {
      window.luna.workspace.getMediaResolution(activeMediaPath).then((size) => {
        if (canceled) return
        const working = workingMaskSize(size.width, size.height)
        setMaskSize(working)
        setMaskData(new Uint8Array(working.width * working.height))
      }).catch(() => undefined)
      return () => { canceled = true }
    }
    setBusy(true)
    window.luna.workspace.loadColorMask(projectId, activeMaskPath).then((loaded) => {
      if (canceled) return
      setMaskSize({ width: loaded.width, height: loaded.height })
      setMaskData(new Uint8Array(loaded.bytes))
    }).catch(() => {
      if (!canceled) toast.error('无法读取当前蒙版')
    }).finally(() => {
      if (!canceled) setBusy(false)
    })
    return () => { canceled = true }
  }, [activeMaskPath, activeMediaId, activeMediaPath, available, projectId])

  const commitMask = useCallback(async (data: Uint8Array) => {
    if (!media.currentProject || !media.activeMedia || !maskSize) {
      toast.error('请先在项目中打开一张图片')
      return
    }
    setBusy(true)
    try {
      const saved = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        media.activeMedia.id,
        maskSize.width,
        maskSize.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        activeMask?.feather ?? 0,
      )
      setMaskData(new Uint8Array(data))
      const layerId = activeMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const layer: ColorMaskLayer = {
          path: saved.path,
          width: saved.width,
          height: saved.height,
          opacity: activeMask?.opacity ?? 1,
          inverted: activeMask?.inverted ?? false,
          feather: activeMask?.feather ?? 0,
          kind: activeMask?.kind ?? 'brush',
          classId: activeMask?.classId,
          className: activeMask?.className,
          modelId: activeMask?.modelId,
          id: layerId,
          name: activeMask?.name ?? `蒙版 ${edit.pipeline.colorMasks.length + 1}`,
          enabled: activeMask?.enabled ?? true,
          color: activeMask?.color ?? createDefaultPipeline().color,
      }
      edit.commitPatch({ colorMasks: activeMask
        ? edit.pipeline.colorMasks.map((item) => item.id === layerId ? layer : item)
        : [...edit.pipeline.colorMasks, layer] })
      setActiveLayerId(layerId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存蒙版失败')
    } finally {
      setBusy(false)
    }
  }, [activeMask, edit, maskSize, media.activeMedia, media.currentProject])

  const updateMaskSettings = useCallback((patch: { opacity?: number; inverted?: boolean; feather?: number }) => {
    if (!activeMask) return
    edit.commitPatch({ colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === activeMask.id ? { ...layer, ...patch } : layer) })
  }, [activeMask, edit])

  const updateLayer = useCallback((id: string, patch: Partial<Pick<ColorMaskLayer, 'name' | 'enabled' | 'color'>>) => {
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

  const moveActiveLayer = useCallback((direction: -1 | 1) => {
    if (!activeMask) return
    const current = edit.pipeline.colorMasks.findIndex((layer) => layer.id === activeMask.id)
    const target = current + direction
    if (current < 0 || target < 0 || target >= edit.pipeline.colorMasks.length) return
    const next = [...edit.pipeline.colorMasks]
    ;[next[current], next[target]] = [next[target], next[current]]
    edit.commitPatch({ colorMasks: next })
  }, [activeMask, edit])

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

  const generateSemanticMask = useCallback(async (point?: { x: number; y: number }) => {
    if (!media.activeMedia || !media.currentProject || !maskSize) return
    setBusy(true)
    setSegmentationProgress({ phase: 'model', label: '正在准备模型', percent: null })
    try {
      const result = await window.luna.workspace.segmentImage(media.activeMedia.path, point, segmentationModel)
      setLastSegmentationPerformance(result.performance)
      setMaskSize({ width: result.width, height: result.height })
      const data = new Uint8Array(result.bytes)
      setMaskData(data)
      const saved = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        media.activeMedia.id,
        result.width,
        result.height,
        result.bytes,
        activeMask?.feather ?? 2,
      )
      const layerId = activeMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const layer: ColorMaskLayer = {
          path: saved.path,
          width: saved.width,
          height: saved.height,
          opacity: activeMask?.opacity ?? 1,
          inverted: activeMask?.inverted ?? false,
          feather: activeMask?.feather ?? 2,
          kind: 'semantic',
          classId: result.classId,
          className: result.className,
          modelId: result.modelId,
          id: layerId,
          name: activeMask?.name ?? result.className ?? `蒙版 ${edit.pipeline.colorMasks.length + 1}`,
          enabled: activeMask?.enabled ?? true,
          color: activeMask?.color ?? createDefaultPipeline().color,
      }
      edit.commitPatch({ colorMasks: activeMask
        ? edit.pipeline.colorMasks.map((item) => item.id === layerId ? layer : item)
        : [...edit.pipeline.colorMasks, layer] })
      setActiveLayerId(layerId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '智能选择失败')
    } finally {
      setBusy(false)
      setSegmentationProgress(null)
    }
  }, [activeMask, edit, maskSize, media.activeMedia, media.currentProject, segmentationModel])

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
    activeLayerId,
    activeMask,
    setActiveLayerId,
    createMask,
    updateLayer,
    updateActiveLayer,
    duplicateLayer,
    removeLayer,
    moveActiveLayer,
    commitMask,
    updateMaskSettings,
    removeMask,
    generateSemanticMask,
  }), [activeLayerId, activeMask, available, brushMode, brushSize, busy, commitMask, createMask, duplicateLayer, editing, generateSemanticMask, lastSegmentationPerformance, maskData, maskSize, moveActiveLayer, removeLayer, removeMask, segmentationModel, segmentationProgress, semanticPicking, setSegmentationModel, showOverlay, updateActiveLayer, updateLayer, updateMaskSettings])

  return <WorkspaceMaskContext.Provider value={value}>{children}</WorkspaceMaskContext.Provider>
}

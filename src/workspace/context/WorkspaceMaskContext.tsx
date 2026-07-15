import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { toast } from '../../ui'
import { isImagePath } from '../../lib/fileUtils'
import { useWorkspaceEdit } from './WorkspaceEditContext'
import { useWorkspaceMedia } from './WorkspaceMediaContext'

export type MaskBrushMode = 'paint' | 'erase'
export type SegmentationModelId = 'segformer-b0-ade20k' | 'segformer-b2-ade20k'

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
  const [segmentationModel, setSegmentationModelState] = useState<SegmentationModelId>(() => (
    localStorage.getItem('workspace_segmentation_model') === 'segformer-b2-ade20k'
      ? 'segformer-b2-ade20k'
      : 'segformer-b0-ade20k'
  ))
  const available = Boolean(media.currentProject && media.activeMedia?.path && isImagePath(media.activeMedia.path))
  const activeMask = edit.pipeline.colorMask
  const activeMaskPath = activeMask?.path
  const activeMediaId = media.activeMedia?.id
  const activeMediaPath = media.activeMedia?.path
  const projectId = media.currentProject?.id

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
      edit.commitPatch({
        colorMask: {
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
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存蒙版失败')
    } finally {
      setBusy(false)
    }
  }, [activeMask, edit, maskSize, media.activeMedia, media.currentProject])

  const updateMaskSettings = useCallback((patch: { opacity?: number; inverted?: boolean; feather?: number }) => {
    if (!activeMask) return
    edit.commitPatch({ colorMask: { ...activeMask, ...patch } })
  }, [activeMask, edit])

  const removeMask = useCallback(async () => {
    if (maskSize) setMaskData(new Uint8Array(maskSize.width * maskSize.height))
    edit.commitPatch({ colorMask: null })
  }, [edit, maskSize])

  const generateSemanticMask = useCallback(async (point?: { x: number; y: number }) => {
    if (!media.activeMedia || !media.currentProject || !maskSize) return
    setBusy(true)
    try {
      const result = await window.luna.workspace.segmentImage(media.activeMedia.path, point, segmentationModel)
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
      edit.commitPatch({
        colorMask: {
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
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '智能选择失败')
    } finally {
      setBusy(false)
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
    commitMask,
    updateMaskSettings,
    removeMask,
    generateSemanticMask,
  }), [available, brushMode, brushSize, busy, commitMask, editing, generateSemanticMask, maskData, maskSize, removeMask, segmentationModel, semanticPicking, setSegmentationModel, showOverlay, updateMaskSettings])

  return <WorkspaceMaskContext.Provider value={value}>{children}</WorkspaceMaskContext.Provider>
}

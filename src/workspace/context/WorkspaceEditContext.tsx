import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { DEFAULT_PIPELINE, mergePipeline } from '../shared/editPipeline'
import { toast } from '../../ui'
import { type CropPreset } from '../transform/TransformPanel'
import { useEditPipeline } from '../hooks/useEditPipeline'
import { useCropMachine } from '../hooks/useCropMachine'
import type { WorkspaceTool } from '../components/WorkspaceEditSidebar'

const PIPELINE_CLIPBOARD_KEY = 'workspace_pipeline_clipboard'

interface ClipboardData {
  color: EditPipeline['color']
  effects: EditPipeline['effects']
  watermark: EditPipeline['watermark']
}

interface WorkspaceEditValue {
  // Pipeline & History
  pipeline: EditPipeline
  previewPipeline: EditPipeline
  comparePipeline: EditPipeline
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  commitPatch: (patch: PipelinePatch) => void
  resetPipeline: () => void
  initializePipeline: (pipe: EditPipeline) => void

  // Active Tool
  activeTool: WorkspaceTool
  setActiveTool: (tool: WorkspaceTool) => void

  // Compare mode
  compareOriginal: boolean
  setCompareOriginal: (v: boolean) => void

  // Pipette
  pipetteActive: boolean
  setPipetteActive: (v: boolean) => void

  // Crop state machine
  cropActive: boolean
  transformDraft: EditPipeline['transform'] | null
  cropPreset: CropPreset
  cropSize: { width: number; height: number }
  activeTransform: EditPipeline['transform']
  setTransformDraft: React.Dispatch<React.SetStateAction<EditPipeline['transform'] | null>>
  setCropActive: (v: boolean) => void
  setCropPreset: (v: CropPreset) => void
  setCropSize: (v: { width: number; height: number }) => void
  setPreviousTool: (tool: WorkspaceTool) => void
  startCrop: (sourceAspect: number) => void
  applyCropAspect: (targetAspect: number, sourceAspect: number, nextSize?: { width: number; height: number }) => void
  handleCropPresetChange: (preset: CropPreset, sourceAspect: number) => void
  handleCropSizeChange: (size: { width?: number; height?: number }, sourceAspect: number) => void
  handleRotateChange: (rotate: number) => void
  confirmCrop: () => void
  cancelCrop: () => void
  exitCropMode: () => void

  // Crop-aware pipeline update
  selectTool: (tool: WorkspaceTool, sourceAspect?: number) => void
  updateWorkspacePanel: (patch: PipelinePatch) => void

  // Clipboard
  copyPipeline: () => void
  pasteToCurrent: () => void
}

const WorkspaceEditContext = createContext<WorkspaceEditValue | null>(null)

export function useWorkspaceEdit(): WorkspaceEditValue {
  const ctx = useContext(WorkspaceEditContext)
  if (!ctx) throw new Error('useWorkspaceEdit must be used within WorkspaceEditProvider')
  return ctx
}

export function WorkspaceEditProvider({ children }: { children: React.ReactNode }) {
  const {
    pipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    resetPipeline,
    initializePipeline,
  } = useEditPipeline()

  const [activeTool, setActiveTool] = useState<WorkspaceTool>('color')
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [pipetteActive, setPipetteActive] = useState(false)

  const cropMachine = useCropMachine(pipeline, commitPatch, setActiveTool)

  // Derived pipelines
  const previewPipeline = useMemo(
    () => (cropMachine.cropActive && cropMachine.transformDraft
      ? mergePipeline(pipeline, { transform: cropMachine.transformDraft })
      : pipeline),
    [cropMachine.cropActive, cropMachine.transformDraft, pipeline],
  )
  const comparePipeline = useMemo(
    () => mergePipeline(previewPipeline, { color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects }),
    [previewPipeline],
  )

  // Clipboard
  const pipelineClipboardRef = useRef<ClipboardData | null>(null)

  const copyPipeline = useCallback(() => {
    pipelineClipboardRef.current = {
      color: structuredClone(pipeline.color),
      effects: structuredClone(pipeline.effects),
      watermark: structuredClone(pipeline.watermark),
    }
    localStorage.setItem(PIPELINE_CLIPBOARD_KEY, JSON.stringify(pipelineClipboardRef.current))
    toast.success('已复制调色和水印设置')
  }, [pipeline])

  const pasteToCurrent = useCallback(() => {
    const data = pipelineClipboardRef.current ?? (() => {
      const raw = localStorage.getItem(PIPELINE_CLIPBOARD_KEY)
      if (!raw) { toast.error('没有可粘贴的调色设置'); return null }
      try { return JSON.parse(raw) as ClipboardData } catch { return null }
    })()
    if (!data) return
    commitPatch({ color: data.color, effects: data.effects, watermark: data.watermark })
    toast.success('已粘贴调色和水印设置')
  }, [commitPatch])

  // Crop-aware pipeline update: draft in crop mode, commit otherwise
  const updateWorkspacePanel = useCallback((patch: PipelinePatch) => {
    if (cropMachine.cropActive && patch.transform) {
      cropMachine.setTransformDraft(
        (current) => ({ ...(current ?? pipeline.transform), ...patch.transform }),
      )
      return
    }
    commitPatch(patch)
  }, [cropMachine.cropActive, cropMachine.setTransformDraft, pipeline.transform, commitPatch])

  // Tool switching with optional crop start (needs sourceAspect from Canvas context)
  const selectTool = useCallback((tool: WorkspaceTool, sourceAspect: number = 1) => {
    if (tool === 'crop') {
      if (activeTool !== 'crop') cropMachine.setPreviousTool(activeTool)
      setActiveTool('crop')
      if (cropMachine.cropActive) return
      cropMachine.startCrop(sourceAspect)
      return
    }
    if (cropMachine.cropActive) {
      cropMachine.exitCropMode()
    }
    setActiveTool(tool)
  }, [activeTool, cropMachine.setPreviousTool, cropMachine.cropActive, cropMachine.startCrop, cropMachine.exitCropMode])

  // Pipette effect (eye dropper)
  useEffect(() => {
    if (!pipetteActive) return
    if (typeof (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper !== 'function') {
      toast.error('当前浏览器不支持取色器')
      setPipetteActive(false)
      return
    }
    const EyeDropper = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
    const dropper = new EyeDropper()
    dropper.open().then((result: { sRGBHex: string }) => {
      const hex = result.sRGBHex
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const avg = (r + g + b) / 3
      if (avg > 0.01 && avg < 0.99) {
        const temperature = Math.max(-100, Math.min(100, Math.round(pipeline.color.temperature + (b - r) * 100)))
        const tint = Math.max(-100, Math.min(100, Math.round((g - (r + b) / 2) * 100)))
        commitPatch({ color: { temperature, tint, whiteBalanceMode: 'custom' } })
      }
    }).catch(() => {
      // User cancelled — ignore
    }).finally(() => {
      setPipetteActive(false)
    })
  }, [pipetteActive, commitPatch, pipeline.color.temperature])

  const value = useMemo<WorkspaceEditValue>(() => ({
    pipeline,
    previewPipeline,
    comparePipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    resetPipeline,
    initializePipeline,
    activeTool,
    setActiveTool,
    compareOriginal,
    setCompareOriginal,
    pipetteActive,
    setPipetteActive,
    ...cropMachine,
    selectTool,
    updateWorkspacePanel,
    copyPipeline,
    pasteToCurrent,
  }), [
    pipeline,
    previewPipeline,
    comparePipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    resetPipeline,
    initializePipeline,
    activeTool,
    setActiveTool,
    compareOriginal,
    setCompareOriginal,
    pipetteActive,
    setPipetteActive,
    cropMachine,
    selectTool,
    updateWorkspacePanel,
    copyPipeline,
    pasteToCurrent,
  ])

  return (
    <WorkspaceEditContext.Provider value={value}>
      {children}
    </WorkspaceEditContext.Provider>
  )
}

import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'

import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { DEFAULT_PIPELINE, mergePipeline } from '../shared/editPipeline'
import type { HistoryGroup } from '../shared/editHistory'
import { toast } from '../../ui'
import { type CropPreset } from '../transform/TransformPanel'
import { useEditPipeline } from '../hooks/useEditPipeline'
import { useCropMachine } from '../hooks/useCropMachine'
import type { WorkspaceTool } from '../components/WorkspaceEditSidebar'
import { useTrimMachine } from '../trim/useTrimMachine'
import { beautyClipboardSettings, type BeautyClipboardSettings } from '../beauty/beautyLayers'

const PIPELINE_CLIPBOARD_KEY = 'workspace_pipeline_clipboard'

export interface WorkspacePipelineClipboardData {
  sourceAssetId?: string
  sourceProjectId?: string | null
  color: EditPipeline['color']
  effects: EditPipeline['effects']
  logRestore: EditPipeline['logRestore']
  lutFilter: EditPipeline['lutFilter']
  watermark: EditPipeline['watermark']
  border: EditPipeline['border']
  beauty?: BeautyClipboardSettings
}

export function readWorkspacePipelineClipboard(): WorkspacePipelineClipboardData | null {
  const raw = localStorage.getItem(PIPELINE_CLIPBOARD_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as WorkspacePipelineClipboardData } catch { return null }
}

export function writeWorkspacePipelineClipboard(data: WorkspacePipelineClipboardData): void {
  localStorage.setItem(PIPELINE_CLIPBOARD_KEY, JSON.stringify(data))
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
  commitPatch: (patch: PipelinePatch, group?: HistoryGroup) => void
  commitUpdate: (update: (pipeline: EditPipeline) => EditPipeline, group?: HistoryGroup) => void
  applySystemUpdate: (update: (pipeline: EditPipeline) => EditPipeline) => void
  updatePreview: (update: (pipeline: EditPipeline) => EditPipeline) => void
  clearPreview: () => void
  retainedMaskPaths: string[]
  resetPipeline: (pipeline?: EditPipeline) => void
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

  // Beauty mask preview (session-only)
  beautyMaskPreview: boolean
  setBeautyMaskPreview: (v: boolean) => void
  beautyRetouchActive: boolean
  setBeautyRetouchActive: (v: boolean) => void
  beautyRetouchBrushSize: number
  setBeautyRetouchBrushSize: (v: number) => void
  beautyRetouchMode: 'repair' | 'erase' | null
  setBeautyRetouchMode: (v: 'repair' | 'erase' | null) => void

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
  startCrop: (sourceAspect: number, mediaSize?: { w: number; h: number }) => void
  applyCropAspect: (targetAspect: number, sourceAspect: number, nextSize?: { width: number; height: number }) => void
  handleCropPresetChange: (preset: CropPreset, sourceAspect: number, mediaSize?: { w: number; h: number }) => void
  handleCropSizeChange: (size: { width?: number; height?: number }, sourceAspect: number, mediaSize?: { w: number; h: number }) => void
  handleRotateChange: (rotate: number) => void
  confirmCrop: () => void
  cancelCrop: () => void
  exitCropMode: () => void

  // Crop-aware pipeline update
  selectTool: (tool: WorkspaceTool, sourceAspect?: number, mediaSize?: { w: number; h: number }) => void
  updateWorkspacePanel: (patch: PipelinePatch) => void

  // Clipboard
  copyPipeline: (source?: { assetId: string; projectId: string | null }) => void

  // Trim
  trimActive: boolean
  setTrimActive: (v: boolean) => void
  activateTrim: () => void
  deactivateTrim: () => void
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
    previewPipeline: draftPipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    commitUpdate,
    applySystemUpdate,
    retainedMaskPaths,
    resetPipeline,
    initializePipeline,
    updatePreview,
    clearPreview,
  } = useEditPipeline()

  const [activeTool, setActiveTool] = useState<WorkspaceTool>('color')
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [pipetteActive, setPipetteActive] = useState(false)
  const [beautyMaskPreview, setBeautyMaskPreview] = useState(false)
  const [beautyRetouchActive, setBeautyRetouchActive] = useState(false)
  const [beautyRetouchBrushSize, setBeautyRetouchBrushSize] = useState(24)
  const [beautyRetouchMode, setBeautyRetouchMode] = useState<'repair' | 'erase' | null>(null)

  const cropMachine = useCropMachine(pipeline, commitPatch, setActiveTool)
  const trimMachine = useTrimMachine()

  // Derived pipelines
  const previewPipeline = useMemo(
    () => (cropMachine.cropActive && cropMachine.transformDraft
      ? mergePipeline(draftPipeline, { transform: cropMachine.transformDraft })
      : draftPipeline),
    [cropMachine.cropActive, cropMachine.transformDraft, draftPipeline],
  )
  const comparePipeline = useMemo(
    () => {
      if (!compareOriginal) return previewPipeline
      return mergePipeline(previewPipeline, {
        color: DEFAULT_PIPELINE.color,
        effects: DEFAULT_PIPELINE.effects,
        logRestore: DEFAULT_PIPELINE.logRestore,
        lutFilter: DEFAULT_PIPELINE.lutFilter,
        colorMasks: [],
        beautyMasks: [],
        border: { ...DEFAULT_PIPELINE.border, enabled: previewPipeline.border.enabled },
      })
    },
    [compareOriginal, previewPipeline],
  )

  // Clipboard
  const copyPipeline = useCallback((source?: { assetId: string; projectId: string | null }) => {
    const data: WorkspacePipelineClipboardData = {
      sourceAssetId: source?.assetId,
      sourceProjectId: source?.projectId,
      color: structuredClone(pipeline.color),
      effects: structuredClone(pipeline.effects),
      logRestore: structuredClone(pipeline.logRestore),
      lutFilter: structuredClone(pipeline.lutFilter),
      watermark: structuredClone(pipeline.watermark),
      border: structuredClone(pipeline.border),
      beauty: structuredClone(beautyClipboardSettings(pipeline)),
    }
    writeWorkspacePipelineClipboard(data)
    toast.success(data.beauty ? '已复制效果和美颜参数' : '已复制调色、滤镜、水印和边框设置')
  }, [pipeline])

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

  // Tool switching with optional crop/trim start (needs sourceAspect from Canvas context)
  const selectTool = useCallback((tool: WorkspaceTool, sourceAspect: number = 1, mediaSize?: { w: number; h: number }) => {
    if (tool === 'crop') {
      if (!trimMachine.trimActive) {
        if (activeTool !== 'crop') cropMachine.setPreviousTool(activeTool)
        setActiveTool('crop')
        if (cropMachine.cropActive) return
        cropMachine.startCrop(sourceAspect, mediaSize)
      } else {
        setActiveTool('crop')
      }
      return
    }
    if (tool === 'trim') {
      if (trimMachine.trimActive && activeTool === 'trim') {
        // 再次点击退出截取模式
        trimMachine.deactivateTrim()
        setActiveTool('color')
        return
      }
      // 首次进入截取模式时，如果 pipeline.trim 为 null 则初始化为完整范围
      if (!cropMachine.cropActive) {
        setActiveTool('trim')
        trimMachine.activateTrim()
      } else {
        setActiveTool('trim')
      }
      return
    }
    if (cropMachine.cropActive) {
      cropMachine.exitCropMode()
    }
    if (trimMachine.trimActive) {
      trimMachine.deactivateTrim()
    }
    setActiveTool(tool)
  }, [activeTool, cropMachine, trimMachine])

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
    commitUpdate,
    applySystemUpdate,
    retainedMaskPaths,
    resetPipeline,
    initializePipeline,
    updatePreview,
    clearPreview,
    activeTool,
    setActiveTool,
    compareOriginal,
    setCompareOriginal,
    pipetteActive,
    setPipetteActive,
    beautyMaskPreview,
    setBeautyMaskPreview,
    beautyRetouchActive,
    setBeautyRetouchActive,
    beautyRetouchBrushSize,
    setBeautyRetouchBrushSize,
    beautyRetouchMode,
    setBeautyRetouchMode,
    ...cropMachine,
    ...trimMachine,
    selectTool,
    updateWorkspacePanel,
    copyPipeline,
  }), [
    pipeline,
    previewPipeline,
    comparePipeline,
    canUndo,
    canRedo,
    undo,
    redo,
    commitPatch,
    commitUpdate,
    applySystemUpdate,
    retainedMaskPaths,
    resetPipeline,
    initializePipeline,
    updatePreview,
    clearPreview,
    activeTool,
    setActiveTool,
    compareOriginal,
    setCompareOriginal,
    pipetteActive,
    setPipetteActive,
    beautyMaskPreview,
    beautyRetouchActive,
    beautyRetouchBrushSize,
    beautyRetouchMode,
    cropMachine,
    trimMachine,
    selectTool,
    updateWorkspacePanel,
    copyPipeline,
  ])

  return (
    <WorkspaceEditContext.Provider value={value}>
      {children}
    </WorkspaceEditContext.Provider>
  )
}

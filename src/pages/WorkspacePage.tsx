import { ArrowLeft, ClipboardCopy, ClipboardPaste, Download, Eye, EyeOff, LayoutTemplate, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../shared/types'
import { Button, Dialog, IconButton, Tooltip, toast } from '../ui'
import { checkWebGLSupport, WebGLRenderer, workspaceImageCache } from '../workspace'
import { createEditHistory, pushHistory, redoHistory, resetHistory, undoHistory, type EditHistory } from '../workspace/shared/editHistory'
import { createDefaultPipeline, DEFAULT_PIPELINE, mergePipeline, type EditPipeline, type PipelinePatch } from '../workspace/shared/editPipeline'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import type { CropPreset } from '../workspace/transform/TransformPanel'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { WorkspaceWatermarkOverlay } from '../workspace/components/WorkspaceWatermarkOverlay'
import { useWorkspaceExport } from '../workspace/export/useWorkspaceExport'
import { cropForAspect, frameAspect, maxCropInsideImage } from '../workspace/transform/cropGeometry'
import { WorkspaceEditSidebar, type WorkspaceTool } from '../workspace/components/WorkspaceEditSidebar'
import type { WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'

/** 复制到粘贴板：只复制调色+效果+水印，不含裁剪等变换 */
const PIPELINE_CLIPBOARD_KEY = 'workspace_pipeline_clipboard'
const DEFAULT_WHITE_BALANCE_KELVIN = 5500

function clampKelvin(value: number): number {
  return Math.max(2000, Math.min(15000, Math.round(value)))
}

interface WorkspaceRouteState {
  project?: WorkspaceProject
  media?: WorkspaceMediaAsset[]
  mediaPaths?: string[]
  initialIndex?: number
}

interface EyeDropperConstructor {
  new(): {
    open(): Promise<{ sRGBHex: string }>
  }
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor
  }
}

function fileNameFromPath(filePath: string): string { return filePath.split(/[\\/]/).pop() || filePath }

function mediaFromState(state: WorkspaceRouteState | null): WorkspaceMediaAsset[] {
  if (state?.media?.length) return state.media
  return (state?.mediaPaths ?? []).map((path, index) => ({
    id: `${path}:${index}`,
    name: fileNameFromPath(path),
    path,
    kind: 'image',
  }))
}

function normalizePipeline(value: unknown): EditPipeline {
  if (!value || typeof value !== 'object') return createDefaultPipeline()
  return mergePipeline(createDefaultPipeline(), value as PipelinePatch)
}

function projectMedia(project: WorkspaceProject | null, fallbackMedia: WorkspaceMediaAsset[]): WorkspaceMediaAsset[] { return project?.assets ?? fallbackMedia }

interface WorkspacePageProps {
  workspaceMode: WorkspaceMode
  onEditingChange?: (editing: boolean) => void
}

export function WorkspacePage({ workspaceMode, onEditingChange }: WorkspacePageProps) {
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null
  const fallbackMedia = useMemo(() => mediaFromState(routeState), [location.key])
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [projectLoading, setProjectLoading] = useState(false)
  const [currentProject, setCurrentProject] = useState<WorkspaceProject | null>(routeState?.project ?? null)
  const [transientMedia, setTransientMedia] = useState<WorkspaceMediaAsset[]>(fallbackMedia)
  const [activeIndex, setActiveIndex] = useState(routeState?.initialIndex ?? 0)
  const [history, setHistory] = useState<EditHistory>(() => createEditHistory(createDefaultPipeline()))
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [webglMessage, setWebglMessage] = useState<string | null>(null)
  const [cropActive, setCropActive] = useState(false)
  const [transformDraft, setTransformDraft] = useState<EditPipeline['transform'] | null>(null)
  const [cropPreset, setCropPreset] = useState<CropPreset>('original')
  const [cropSize, setCropSize] = useState({ width: 0, height: 0 })
  const [activeTool, setActiveTool] = useState<WorkspaceTool>('color')
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [pipetteActive, setPipetteActive] = useState(false)
  const [brokenPaths, setBrokenPaths] = useState<Set<string>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const selectedIndicesRef = useRef(selectedIndices)
  selectedIndicesRef.current = selectedIndices
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [sourceAspect, setSourceAspect] = useState(1)
  const [viewZoom, setViewZoom] = useState(1)
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 })
  const [viewDrag, setViewDrag] = useState<{ x: number; y: number; pan: { x: number; y: number } } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const projectRef = useRef<WorkspaceProject | null>(currentProject)
  const cropActiveRef = useRef(false)
  const previewPipelineRef = useRef<EditPipeline>(history.present)
  const previousToolRef = useRef<WorkspaceTool>('color')
  const saveTimerRef = useRef<number | null>(null)
  const autoWhiteBalanceKeyRef = useRef<string | null>(null)
  const pipeline = history.present
  const activeTransform = cropActive && transformDraft ? transformDraft : pipeline.transform
  const cropAspectRatio = cropPreset === 'free' ? null : cropPreset === 'original' ? frameAspect(sourceAspect, activeTransform.orientation) : (cropSize.width || Math.round(sourceAspect * 2160)) / Math.max(cropSize.height || 2160, 1)
  const previewPipeline = useMemo(
    () => (cropActive && transformDraft ? mergePipeline(pipeline, { transform: transformDraft }) : pipeline),
    [cropActive, transformDraft, pipeline],
  )
  const comparePipeline = useMemo(() => mergePipeline(previewPipeline, { color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects }), [previewPipeline])
  const media = projectMedia(currentProject, transientMedia)
  const activeMedia = media[activeIndex] ?? null
  const editorOpen = Boolean(currentProject || transientMedia.length > 0)
  const canRender = Boolean(rendererRef.current && activeMedia && !webglMessage?.includes('不支持'))
  const exportWorkspaceImage = useWorkspaceExport({ activeMedia, canvasRef, imageRect, pipeline: previewPipeline })

  useEffect(() => {
    onEditingChange?.(editorOpen)
    return () => onEditingChange?.(false)
  }, [editorOpen, onEditingChange])
  const commitPatch = useCallback((patch: PipelinePatch) => {
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch)))
  }, [])

  useEffect(() => {
    if (routeState?.project) {
      setCurrentProject(routeState.project)
      setActiveIndex(Math.min(routeState.initialIndex ?? 0, routeState.project.assets.length - 1))
    } else if (fallbackMedia.length) {
      setTransientMedia(fallbackMedia)
      setActiveIndex(Math.min(routeState?.initialIndex ?? 0, fallbackMedia.length - 1))
    }
  }, [location.key])

  useEffect(() => {
    setViewZoom(1)
    setViewPan({ x: 0, y: 0 })
  }, [activeMedia?.path])

  useEffect(() => {
    projectRef.current = currentProject
  }, [currentProject])

  useEffect(() => {
    previewPipelineRef.current = previewPipeline
  }, [previewPipeline])

  useEffect(() => {
    cropActiveRef.current = cropActive
  }, [cropActive])

  useEffect(() => {
    setProjectLoading(true)
    window.luna.workspace.listProjects()
      .then(setProjects)
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setProjectLoading(false))
  }, [])

  // 全局快捷键
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // 全局阻止空格默认行为（使用捕获阶段在滑块内部处理前拦截）
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        // 在输入框中只阻止，不触发对比功能
        const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
        if (!inInput && !cropActiveRef.current && activeMedia) {
          setCompareOriginal(true)
        }
        return
      }

      // 在文本输入框中不触发其他快捷键
      const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
      if (inInput) return
      // Delete / Backspace 删除素材（支持多选）
      if ((event.code === 'Delete' || event.code === 'Backspace') && activeMedia && !cropActiveRef.current) {
        const removalCount = selectedIndicesRef.current.size || 1
        if (removalCount >= media.length) return
        event.preventDefault()
        setDeleteConfirmOpen(true)
        return
      }
      // Ctrl/Cmd+Shift+C 复制调色和水印设置
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyC' && !cropActiveRef.current) {
        event.preventDefault()
        copyPipelineRef.current()
        return
      }
      // Ctrl/Cmd+Shift+V 粘贴调色和水印设置
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyV' && !cropActiveRef.current) {
        event.preventDefault()
        pasteToCurrentRef.current()
        return
      }
    }
    function handleKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        setCompareOriginal(false)
      }
    }
    // 使用捕获阶段，确保在滑块/输入框内部处理 Space 之前拦截
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, [activeMedia, media.length, cropActiveRef.current])

  useEffect(() => {
    const support = checkWebGLSupport()
    if (!support.supported) {
      setWebglMessage(support.message ?? '当前设备不支持工作台渲染')
      return
    }
    setWebglMessage(support.message ?? null)
  }, [])

  const updateImageRect = useCallback(() => {
    const rect = rendererRef.current?.getDisplayRect()
    if (rect) setImageRect(rect)
    const aspect = rendererRef.current?.getSourceAspect()
    if (aspect) setSourceAspect(aspect)
  }, [])

  useEffect(() => {
    if (!editorOpen || !canvasRef.current || rendererRef.current || webglMessage?.includes('不支持')) return
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current)
      const bounds = canvasRef.current.getBoundingClientRect()
      rendererRef.current.resize(bounds.width, bounds.height)
      rendererRef.current.render(previewPipelineRef.current, { cropMode: cropActiveRef.current })
      updateImageRect()
    } catch (error) {
      setWebglMessage(error instanceof Error ? error.message : String(error))
    }
    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [editorOpen, updateImageRect, webglMessage])

  useEffect(() => {
    if (!stageRef.current || !rendererRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      rendererRef.current?.resize(width, height)
      rendererRef.current?.render(compareOriginal ? comparePipeline : previewPipeline, { cropMode: cropActive })
      updateImageRect()
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [compareOriginal, comparePipeline, cropActive, previewPipeline, updateImageRect])

  useEffect(() => {
    if (!activeMedia || !rendererRef.current) return
    let canceled = false
    setImageLoading(true)
    setImageError(null)
    workspaceImageCache.generate(activeMedia.path)
      .then((entry) => {
        if (canceled) return
        rendererRef.current?.loadImage(entry.previewBitmap)
        rendererRef.current?.render(compareOriginal ? mergePipeline(previewPipelineRef.current, { color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects }) : previewPipelineRef.current, { cropMode: cropActiveRef.current })
        updateImageRect()
        const applyThumb = <T extends WorkspaceMediaAsset>(items: T[]): T[] =>
          items.map((item) => (item.path === activeMedia.path ? { ...item, thumbnailUrl: entry.thumbnailUrl } : item)) as T[]
        if (projectRef.current) {
          const nextProject = { ...projectRef.current, assets: applyThumb(projectRef.current.assets) }
          projectRef.current = nextProject
          setCurrentProject(nextProject)
          window.luna.workspace.saveProject(nextProject).catch(() => undefined)
        } else {
          setTransientMedia(applyThumb)
        }
      })
      .catch((error) => {
        if (!canceled) {
          const msg = error instanceof Error ? error.message : String(error)
          setImageError(msg)
          if (msg.includes('Input file is missing') || msg.includes('文件不存在') || msg.includes('no such file') || msg.includes('ENOENT')) {
            setBrokenPaths((prev) => new Set(prev).add(activeMedia.path))
          }
        }
      })
      .finally(() => {
        if (!canceled) setImageLoading(false)
      })
    return () => { canceled = true }
  }, [activeMedia?.path, compareOriginal, updateImageRect])

  useEffect(() => {
    rendererRef.current?.render(compareOriginal ? comparePipeline : previewPipeline, { cropMode: cropActive })
  }, [compareOriginal, comparePipeline, previewPipeline, cropActive])

  useEffect(() => {
    const asset = currentProject?.assets[activeIndex]
    setCropActive(false)
    setTransformDraft(null)
    setCropPreset('original')
    setHistory(createEditHistory(normalizePipeline(asset?.pipeline)))
  }, [activeIndex, currentProject?.id])

  useEffect(() => {
    if (pipeline.color.whiteBalanceMode !== 'auto') {
      autoWhiteBalanceKeyRef.current = null
      return
    }
    if (!activeMedia) return
    const key = `${activeMedia.path}:${pipeline.color.whiteBalanceMode}`
    if (autoWhiteBalanceKeyRef.current === key) return
    autoWhiteBalanceKeyRef.current = key
    let canceled = false
    window.luna.workspace.readColorMetadata(activeMedia.path)
      .then((metadata) => {
        if (canceled) return
        const temperature = metadata.temperatureKelvin ? clampKelvin(metadata.temperatureKelvin) : DEFAULT_WHITE_BALANCE_KELVIN
        const tint = metadata.tint ?? 0
        commitPatch({ color: { temperature, tint, whiteBalanceMode: 'auto' } })
      })
      .catch(() => undefined)
    return () => { canceled = true }
  }, [activeMedia?.path, pipeline.color.whiteBalanceMode, commitPatch])

  useEffect(() => {
    if (!currentProject || !activeMedia) return
    const baseProject = projectRef.current
    if (!baseProject) return
    const nextProject: WorkspaceProject = {
      ...baseProject,
      assets: baseProject.assets.map((asset, index) => (index === activeIndex ? { ...asset, pipeline } : asset)),
    }
    projectRef.current = nextProject
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      window.luna.workspace.saveProject(nextProject).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    }, 500)
  }, [activeIndex, activeMedia, currentProject?.id, pipeline])

  // 复制粘贴板：只存调色 + 效果 + 水印，不含变换
  const pipelineClipboardRef = useRef<{ color: EditPipeline['color']; effects: EditPipeline['effects']; watermark: EditPipeline['watermark'] } | null>(null)

  function copyPipeline(): void {
    pipelineClipboardRef.current = {
      color: structuredClone(pipeline.color),
      effects: structuredClone(pipeline.effects),
      watermark: structuredClone(pipeline.watermark),
    }
    localStorage.setItem(PIPELINE_CLIPBOARD_KEY, JSON.stringify(pipelineClipboardRef.current))
    toast.success('已复制调色和水印设置')
  }

  function pasteToCurrent(): void {
    const data = pipelineClipboardRef.current ?? (() => {
      const raw = localStorage.getItem(PIPELINE_CLIPBOARD_KEY)
      if (!raw) { toast.error('没有可粘贴的调色设置'); return null }
      try { return JSON.parse(raw) as typeof pipelineClipboardRef.current } catch { return null }
    })()
    if (!data) return
    commitPatch({ color: data.color, effects: data.effects, watermark: data.watermark })
    toast.success('已粘贴调色和水印设置')
  }

  // ref 包装函数，以便在键盘事件（useEffect 闭包）中稳定调用
  const copyPipelineRef = useRef(copyPipeline)
  const pasteToCurrentRef = useRef(pasteToCurrent)
  copyPipelineRef.current = copyPipeline
  pasteToCurrentRef.current = pasteToCurrent

  function updatePipeline(patch: PipelinePatch): void { commitPatch(patch) }

  function updateWorkspacePanel(patch: PipelinePatch): void {
    if (cropActive && patch.transform) {
      setTransformDraft((current) => ({ ...(current ?? pipeline.transform), ...patch.transform }))
      return
    }
    updatePipeline(patch)
  }

  useEffect(() => {
    if (!pipetteActive) return
    if (typeof window.EyeDropper !== 'function') {
      toast.error('当前浏览器不支持取色器')
      setPipetteActive(false)
      return
    }
    const dropper = new window.EyeDropper()
    dropper.open().then((result: { sRGBHex: string }) => {
      const hex = result.sRGBHex
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const avg = (r + g + b) / 3
      if (avg > 0.01 && avg < 0.99) {
        const temperature = clampKelvin((pipeline.color.temperature || DEFAULT_WHITE_BALANCE_KELVIN) + (b - r) * 4500)
        const tint = Math.max(-100, Math.min(100, Math.round((g - (r + b) / 2) * 100)))
        commitPatch({ color: { temperature, tint, whiteBalanceMode: 'custom' } })
      }
    }).catch(() => {
      // User cancelled — ignore
    }).finally(() => {
      setPipetteActive(false)
    })
  }, [pipetteActive, commitPatch, pipeline.color.temperature])

  // 多选处理：Shift 范围选，Ctrl/Cmd 切换选
  function handleSelectionChange(clickedIndex: number, modifiers: { shift: boolean; ctrl: boolean; meta: boolean }): void {
    setSelectedIndices((prev) => {
      if (modifiers.shift && prev.size > 0) {
        // Shift: 从最近的选中项到当前点击项范围选中
        const sorted = [...prev].sort((a, b) => a - b)
        const nearest = sorted.reduce((best, i) =>
          Math.abs(i - clickedIndex) < Math.abs(best - clickedIndex) ? i : best,
        )
        const [from, to] = nearest < clickedIndex ? [nearest, clickedIndex] : [clickedIndex, nearest]
        const range = new Set<number>()
        for (let i = from; i <= to; i++) range.add(i)
        return range
      }
      if (modifiers.ctrl || modifiers.meta) {
        // Ctrl/Cmd: 切换单项选中
        const next = new Set(prev)
        if (next.has(clickedIndex)) next.delete(clickedIndex)
        else next.add(clickedIndex)
        return next
      }
      // 普通点击：单选
      return new Set([clickedIndex])
    })
  }

  function openProject(project: WorkspaceProject): void {
    setCurrentProject(project)
    setActiveIndex(0)
  }

  function backToProjects(): void {
    setCurrentProject(null)
    setCropActive(false)
    window.luna.workspace.listProjects().then(setProjects).catch(() => undefined)
  }

  function removeBrokenAssets(): void {
    if (!currentProject) {
      setTransientMedia((prev) => prev.filter((item) => !brokenPaths.has(item.path)))
      setBrokenPaths(new Set())
      return
    }
    const nextAssets = currentProject.assets.filter((item) => !brokenPaths.has(item.path))
    const nextProject = { ...currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
    setCurrentProject(nextProject)
    projectRef.current = nextProject
    setBrokenPaths(new Set())
    window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    if (activeIndex >= nextAssets.length) setActiveIndex(Math.max(0, nextAssets.length - 1))
    toast.success('已移除失效的素材')
  }

  function handleRemoveMedia(index: number): void {
    if (!activeMedia || media.length <= 1) return
    if (!currentProject) {
      setTransientMedia((prev) => prev.filter((_, i) => i !== index))
    } else {
      const nextAssets = currentProject.assets.filter((_, i) => i !== index)
      const nextProject = { ...currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
      setCurrentProject(nextProject)
      projectRef.current = nextProject
      window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    }
    if (index <= activeIndex && activeIndex > 0) setActiveIndex(activeIndex - 1)
    else if (index === activeIndex && activeIndex === media.length - 1) setActiveIndex(Math.max(0, activeIndex - 1))
  }

  function handleRemoveSelected(indices: Set<number>): void {
    if (indices.size < 1 || indices.size >= media.length) return
    if (!currentProject) {
      setTransientMedia((prev) => prev.filter((_, i) => !indices.has(i)))
    } else {
      const nextAssets = currentProject.assets.filter((_, i) => !indices.has(i))
      const nextProject = { ...currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
      setCurrentProject(nextProject)
      projectRef.current = nextProject
      window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    }
    const removedBeforeActive = [...indices].filter((i) => i < activeIndex).length
    const remaining = media.length - indices.size
    setActiveIndex(Math.max(0, Math.min(activeIndex - removedBeforeActive, remaining - 1)))
    setSelectedIndices(new Set())
  }

  function handleReset(): void {
    setHistory((current) => resetHistory(current, createDefaultPipeline()))
    setCropActive(false)
    setTransformDraft(null)
  }

  function startCrop(): void {
    const aspectRatio = cropPreset === 'original' ? frameAspect(sourceAspect, pipeline.transform.orientation) : cropPreset === 'free' ? null : (cropSize.width || Math.round(sourceAspect * 2160)) / Math.max(cropSize.height || 2160, 1)
    const crop = pipeline.transform.crop ?? maxCropInsideImage({ sourceAspect, orientation: pipeline.transform.orientation, rotate: pipeline.transform.rotate, aspectRatio })
    setTransformDraft({ ...pipeline.transform, crop })
    if (cropSize.width <= 0 || cropSize.height <= 0) setCropSize({ width: Math.round(sourceAspect * 2160), height: 2160 })
    setCropActive(true)
  }

  function handleSelectTool(tool: WorkspaceTool): void {
    if (tool === 'crop') {
      if (activeTool !== 'crop') previousToolRef.current = activeTool
      setActiveTool('crop')
      if (cropActive) return
      startCrop()
      return
    }
    if (cropActive) {
      setTransformDraft(null)
      setCropActive(false)
    }
    setActiveTool(tool)
  }

  function applyCropAspect(targetAspect: number, nextSize?: { width: number; height: number }): void {
    if (!cropActive) setCropActive(true)
    setTransformDraft((current) => ({
      ...(current ?? pipeline.transform),
      crop: cropForAspect(sourceAspect, activeTransform.orientation, targetAspect),
    }))
    if (nextSize) setCropSize(nextSize)
  }

  function handleCropPresetChange(preset: CropPreset): void {
    setCropPreset(preset)
    if (!cropActive) setCropActive(true)
    if (preset === 'free') return
    if (preset === 'original') {
      const width = Math.round(sourceAspect * 2160)
      const height = 2160
      applyCropAspect(sourceAspect, { width, height })
      return
    }
    if (preset === 'custom') {
      const width = cropSize.width || Math.round(sourceAspect * 2160)
      const height = cropSize.height || 2160
      applyCropAspect(width / Math.max(height, 1), { width, height })
      return
    }
    const [w, h] = preset.split(':').map(Number)
    applyCropAspect(w / h, { width: w * 1000, height: h * 1000 })
  }

  function handleCropSizeChange(size: { width?: number; height?: number }): void {
    const width = Math.max(1, Math.round(size.width ?? (cropSize.width || Math.round(sourceAspect * 2160))))
    const height = Math.max(1, Math.round(size.height ?? (cropSize.height || 2160)))
    setCropPreset('custom')
    applyCropAspect(width / height, { width, height })
  }

  function handleRotateChange(rotate: number): void {
    if (!cropActive) {
      setTransformDraft({ ...pipeline.transform, crop: pipeline.transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }, rotate })
      setCropActive(true)
      return
    }
    setTransformDraft((current) => ({ ...(current ?? pipeline.transform), rotate }))
  }

  function confirmCrop(): void {
    if (transformDraft) updatePipeline({ transform: transformDraft })
    setCropActive(false)
    setTransformDraft(null)
    setActiveTool(previousToolRef.current)
  }

  function cancelCrop(): void {
    setTransformDraft(null)
    setCropActive(false)
    setActiveTool(previousToolRef.current)
  }

  function handlePreviewWheel(event: React.WheelEvent): void {
    if (!activeMedia) return
    event.preventDefault()
    setViewZoom((current) => {
      const next = Math.max(1, Math.min(4, current * (event.deltaY > 0 ? 0.9 : 1.1)))
      if (next === 1) setViewPan({ x: 0, y: 0 })
      return Math.round(next * 100) / 100
    })
  }

  function handlePreviewPointerDown(event: React.PointerEvent): void {
    if (cropActive || viewZoom <= 1 || event.button !== 0) return
    setViewDrag({ x: event.clientX, y: event.clientY, pan: viewPan })
    stageRef.current?.setPointerCapture(event.pointerId)
  }

  function handlePreviewPointerMove(event: React.PointerEvent): void {
    if (!viewDrag) return
    setViewPan({
      x: viewDrag.pan.x + event.clientX - viewDrag.x,
      y: viewDrag.pan.y + event.clientY - viewDrag.y,
    })
  }

  function handlePreviewPointerUp(event: React.PointerEvent): void {
    if (!viewDrag) return
    setViewDrag(null)
    stageRef.current?.releasePointerCapture(event.pointerId)
  }

  if (!currentProject && transientMedia.length === 0) {
    return <WorkspaceProjectPicker projects={projects} projectLoading={projectLoading} onOpenProject={openProject} />
  }

  return (
    <div className="workspace-layout">
      <section className="workspace-canvas-shell">
        <div
          ref={stageRef}
          className={`workspace-canvas-stage${workspaceMode === 'creative' ? ' workspace-canvas-stage--hidden' : ''}${cropActive ? ' cropping' : ''}${viewZoom > 1 && !cropActive ? ' panning' : ''}`}
          onWheel={handlePreviewWheel}
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerUp}
          onPointerCancel={handlePreviewPointerUp}
        >
          <div
            className="workspace-preview-surface"
            style={{ transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})` }}
          >
            <canvas ref={canvasRef} className="workspace-canvas" />
            <WorkspaceWatermarkOverlay settings={previewPipeline.watermark} imageRect={imageRect} />
            {cropActive && canRender && (
              <CropOverlay
                crop={activeTransform.crop}
                imageRect={imageRect}
                sourceAspect={sourceAspect}
                orientation={activeTransform.orientation}
                rotate={activeTransform.rotate}
                aspectRatio={cropAspectRatio}
                onCropChange={(crop) => setTransformDraft((current) => ({ ...(current ?? pipeline.transform), crop }))}
                onRotateChange={handleRotateChange}
                onConfirm={confirmCrop}
                onCancel={cancelCrop}
              />
            )}
          </div>
          {(imageLoading || imageError || webglMessage || !activeMedia) && (
            <div className="workspace-stage-status">
              {imageLoading && <span>加载预览中...</span>}
              {!imageLoading && imageError && <span>{imageError}</span>}
              {!imageLoading && !imageError && webglMessage?.includes('不支持') && <span>{webglMessage}</span>}
              {!imageLoading && !imageError && !activeMedia && <span>暂无素材</span>}
            </div>
          )}
        </div>
        {workspaceMode === 'creative' && (
          <div className="workspace-creative-placeholder">
            <div className="workspace-creative-placeholder-icon">
              <LayoutTemplate size={28} />
            </div>
            <h2>开始你的 Live 三拼</h2>
            <p>从下方素材面板拖拽三张竖版 Live 图或视频到三个格子中，松手即可完成拼接。</p>
            <div className="workspace-creative-placeholder-hint">
              也可以直接从电脑文件夹拖入文件
            </div>
          </div>
        )}
      </section>

      {workspaceMode !== 'creative' && (
        <WorkspaceEditSidebar
          activeTool={activeTool}
          pipeline={previewPipeline}
          cropPreset={cropPreset}
          cropWidth={cropSize.width || Math.round(sourceAspect * 2160)}
          cropHeight={cropSize.height || 2160}
          onSelectTool={handleSelectTool}
          onUpdatePipeline={updateWorkspacePanel}
          onRotateChange={handleRotateChange}
          onCropPresetChange={handleCropPresetChange}
          onCropSizeChange={handleCropSizeChange}
          onCancelCrop={cancelCrop}
          onConfirmCrop={confirmCrop}
          onActivatePipette={() => setPipetteActive(true)}
        />
      )}

      <footer className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Tooltip content="返回项目列表">
            <IconButton variant="ghost" size="compact" icon={<ArrowLeft size={16} />} onClick={backToProjects} />
          </Tooltip>
          <Tooltip content="撤销">
            <IconButton variant="ghost" size="compact" icon={<Undo2 size={16} />} disabled={history.past.length === 0} onClick={() => setHistory(undoHistory)} />
          </Tooltip>
          <Tooltip content="重做">
            <IconButton variant="ghost" size="compact" icon={<Redo2 size={16} />} disabled={history.future.length === 0} onClick={() => setHistory(redoHistory)} />
          </Tooltip>
          <Button variant="ghost" size="mini" icon={<RotateCcw size={13} />} onClick={handleReset}>重置</Button>
          <div className="workspace-toolbar-divider" />
          <Tooltip content="复制调色和水印">
            <IconButton variant="ghost" size="compact" icon={<ClipboardCopy size={15} />} disabled={!activeMedia || !canRender} onClick={copyPipeline} />
          </Tooltip>
          <Tooltip content="粘贴调色和水印到当前图片">
            <IconButton variant="ghost" size="compact" icon={<ClipboardPaste size={15} />} disabled={!activeMedia || !canRender} onClick={pasteToCurrent} />
          </Tooltip>
          {brokenPaths.size > 0 && (
            <>
              <div className="workspace-toolbar-divider" />
              <Button variant="danger" size="compact" icon={<Trash2 size={13} />} onClick={removeBrokenAssets}>
                移除 {brokenPaths.size} 个失效素材
              </Button>
            </>
          )}
        </div>
        <div className="workspace-toolbar-title">{currentProject?.name ?? '临时工作台'} · {activeIndex + 1}/{media.length}</div>
        <div className="workspace-toolbar-group">
          <Button
            variant={compareOriginal ? 'primary' : 'secondary'}
            size="compact"
            icon={compareOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
            onMouseDown={() => setCompareOriginal(true)}
            onMouseUp={() => setCompareOriginal(false)}
            onMouseLeave={() => setCompareOriginal(false)}
          >
            对比
          </Button>
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!activeMedia || !canRender} onClick={() => void exportWorkspaceImage()}>
            导出
          </Button>
        </div>
      </footer>

      <WorkspaceMediaStrip
        media={media}
        activeIndex={activeIndex}
        onActiveIndexChange={(index) => { setActiveIndex(index); setSelectedIndices(new Set([index])) }}
        selectedIndices={selectedIndices}
        onSelectionChange={handleSelectionChange}
        brokenPaths={brokenPaths}
        onDragSelectionChange={(indices) => setSelectedIndices(indices)}
      />

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={selectedIndices.size > 1 ? `移除 ${selectedIndices.size} 个素材` : '移除此素材'}
        description={
          selectedIndices.size > 1
            ? `确定从工作台移除这 ${selectedIndices.size} 个素材？不会删除文件，只会从列表中移除。`
            : `确定从工作台移除「${activeMedia?.name ?? ''}」？不会删除文件，只会从列表中移除。`
        }
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="danger" size="compact" onClick={() => {
              if (selectedIndices.size > 1) {
                handleRemoveSelected(selectedIndices)
              } else {
                handleRemoveMedia(activeIndex)
              }
              setDeleteConfirmOpen(false)
            }}>移除</Button>
          </>
        }
      />
    </div>
  )
}

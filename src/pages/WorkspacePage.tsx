import { ArrowLeft, Download, Eye, EyeOff, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../shared/types'
import { Button, IconButton, Tooltip, toast } from '../ui'
import { checkWebGLSupport, WebGLRenderer, workspaceImageCache } from '../workspace'
import { createEditHistory, pushHistory, redoHistory, resetHistory, undoHistory, type EditHistory } from '../workspace/shared/editHistory'
import { createDefaultPipeline, DEFAULT_PIPELINE, mergePipeline, type EditPipeline, type PipelinePatch } from '../workspace/shared/editPipeline'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import type { CropPreset } from '../workspace/transform/TransformPanel'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { cropForAspect, frameAspect, maxCropInsideImage } from '../workspace/transform/cropGeometry'
import { WorkspaceEditSidebar, type WorkspaceTool } from '../workspace/components/WorkspaceEditSidebar'

interface WorkspaceRouteState {
  project?: WorkspaceProject
  media?: WorkspaceMediaAsset[]
  mediaPaths?: string[]
  initialIndex?: number
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

export function WorkspacePage() {
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
  const pipeline = history.present
  const activeTransform = cropActive && transformDraft ? transformDraft : pipeline.transform
  const cropAspectRatio = cropPreset === 'free' ? null : cropPreset === 'original' ? frameAspect(sourceAspect, activeTransform.orientation) : (cropSize.width || Math.round(sourceAspect * 2160)) / Math.max(cropSize.height || 2160, 1)
  const previewPipeline = useMemo(
    () => (cropActive && transformDraft ? mergePipeline(pipeline, { transform: transformDraft }) : pipeline),
    [cropActive, transformDraft, pipeline],
  )
  const comparePipeline = useMemo(
    () => mergePipeline(previewPipeline, { color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects }),
    [previewPipeline],
  )
  const media = projectMedia(currentProject, transientMedia)
  const activeMedia = media[activeIndex] ?? null
  const editorOpen = Boolean(currentProject || transientMedia.length > 0)
  const canRender = Boolean(rendererRef.current && activeMedia && !webglMessage?.includes('不支持'))

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
        if (!canceled) setImageError(error instanceof Error ? error.message : String(error))
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

  const commitPatch = useCallback((patch: PipelinePatch) => {
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch)))
  }, [])

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
    // @ts-ignore — EyeDropper API is Chromium/Electron only, not in TS types
    if (typeof window.EyeDropper !== 'function') {
      toast.error('当前浏览器不支持取色器')
      setPipetteActive(false)
      return
    }
    // @ts-ignore
    const dropper = new window.EyeDropper()
    dropper.open().then((result: { sRGBHex: string }) => {
      const hex = result.sRGBHex
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const avg = (r + g + b) / 3
      if (avg > 0.01 && avg < 0.99) {
        const temperature = Math.max(-100, Math.min(100, Math.round((b - r) * 100)))
        const tint = Math.max(-100, Math.min(100, Math.round((g - (r + b) / 2) * 100)))
        commitPatch({ color: { temperature, tint, whiteBalanceMode: 'custom' } })
      }
    }).catch(() => {
      // User cancelled — ignore
    }).finally(() => {
      setPipetteActive(false)
    })
  }, [pipetteActive, commitPatch])

  function openProject(project: WorkspaceProject): void {
    setCurrentProject(project)
    setActiveIndex(0)
  }

  function backToProjects(): void {
    setCurrentProject(null)
    setCropActive(false)
    window.luna.workspace.listProjects().then(setProjects).catch(() => undefined)
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
          className={`workspace-canvas-stage${cropActive ? ' cropping' : ''}${viewZoom > 1 && !cropActive ? ' panning' : ''}`}
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
      </section>

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
        </div>
        <div className="workspace-toolbar-title">{currentProject?.name ?? '临时工作台'} · {activeMedia?.name ?? '未选择素材'}</div>
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
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!activeMedia} onClick={() => toast.show('工作台导出管线将在下一步接入')}>
            导出
          </Button>
        </div>
      </footer>

      <WorkspaceMediaStrip media={media} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />
    </div>
  )
}

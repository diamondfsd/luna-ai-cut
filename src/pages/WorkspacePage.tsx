import { ArrowLeft, Download, Eye, EyeOff, Folder, ImageIcon, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../shared/types'
import { Accordion, Button, IconButton, Tooltip, toast } from '../ui'
import { ColorPanel } from '../workspace/color/ColorPanel'
import { checkWebGLSupport, WebGLRenderer, workspaceImageCache } from '../workspace'
import { createEditHistory, pushHistory, redoHistory, resetHistory, undoHistory, type EditHistory } from '../workspace/shared/editHistory'
import {
  createDefaultPipeline,
  DEFAULT_PIPELINE,
  mergePipeline,
  type EditPipeline,
  type PipelinePatch,
} from '../workspace/shared/editPipeline'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import { TransformPanel } from '../workspace/transform/TransformPanel'

interface WorkspaceRouteState {
  project?: WorkspaceProject
  media?: WorkspaceMediaAsset[]
  mediaPaths?: string[]
  initialIndex?: number
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

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

function projectMedia(project: WorkspaceProject | null, fallbackMedia: WorkspaceMediaAsset[]): WorkspaceMediaAsset[] {
  return project?.assets ?? fallbackMedia
}

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
  const [cropDraft, setCropDraft] = useState<EditPipeline['transform']['crop']>(null)
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [pipetteActive, setPipetteActive] = useState(false)
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const projectRef = useRef<WorkspaceProject | null>(currentProject)
  const pipelineRef = useRef<EditPipeline>(history.present)
  const saveTimerRef = useRef<number | null>(null)
  const pipeline = history.present
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
    projectRef.current = currentProject
  }, [currentProject])

  useEffect(() => {
    pipelineRef.current = pipeline
  }, [pipeline])

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
  }, [])

  useEffect(() => {
    if (!editorOpen || !canvasRef.current || rendererRef.current || webglMessage?.includes('不支持')) return
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current)
      const bounds = canvasRef.current.getBoundingClientRect()
      rendererRef.current.resize(bounds.width, bounds.height)
      rendererRef.current.render(pipelineRef.current)
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
      rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipeline)
      updateImageRect()
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [compareOriginal, pipeline, updateImageRect])

  useEffect(() => {
    if (!activeMedia || !rendererRef.current) return
    let canceled = false
    setImageLoading(true)
    setImageError(null)
    workspaceImageCache.generate(activeMedia.path)
      .then((entry) => {
        if (canceled) return
        rendererRef.current?.loadImage(entry.previewBitmap)
        rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipelineRef.current)
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
    rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipeline)
  }, [compareOriginal, pipeline])

  useEffect(() => {
    const asset = currentProject?.assets[activeIndex]
    setCropActive(false)
    setCropDraft(null)
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

  function updatePipeline(patch: PipelinePatch): void {
    commitPatch(patch)
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
    setCropDraft(null)
  }

  function handleExport(): void {
    toast.show('工作台导出管线将在下一步接入')
  }

  function startCrop(): void {
    setCropDraft(pipeline.transform.crop ?? { x: 0.12, y: 0.12, w: 0.76, h: 0.76 })
    setCropActive(true)
  }

  function confirmCrop(): void {
    if (cropDraft) updatePipeline({ transform: { crop: cropDraft } })
    setCropActive(false)
  }

  if (!currentProject && transientMedia.length === 0) {
    return (
      <div className="workspace-project-page">
        <header className="workspace-project-header">
          <h2>工作台项目</h2>
          <span>{projectLoading ? '加载中...' : `${projects.length} 个项目`}</span>
        </header>
        <div className="workspace-project-grid">
          {projects.map((project) => (
            <button key={project.id} className="workspace-project-card" type="button" onClick={() => openProject(project)}>
              <span className="workspace-project-folder">
                <Folder size={72} strokeWidth={1.5} />
                <span className="workspace-project-previews">
                  {project.assets.slice(0, 4).map((asset) => (
                    asset.thumbnailUrl ? <img key={asset.id} src={asset.thumbnailUrl} alt="" /> : <span key={asset.id}><ImageIcon size={16} /></span>
                  ))}
                </span>
              </span>
              <span className="workspace-project-name">{project.name}</span>
            </button>
          ))}
          {!projectLoading && projects.length === 0 && (
            <div className="workspace-project-empty">在本地资源中多选图片后创建工作台项目。</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="workspace-layout">
      <section className="workspace-canvas-shell">
        <div ref={stageRef} className="workspace-canvas-stage">
          <canvas ref={canvasRef} className="workspace-canvas" />
          {cropActive && canRender && (
            <CropOverlay
              crop={cropDraft}
              imageRect={imageRect}
              onCropChange={setCropDraft}
              onConfirm={confirmCrop}
              onCancel={() => {
                setCropDraft(null)
                setCropActive(false)
              }}
            />
          )}
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

      <aside className="workspace-params">
        <Accordion
          title="几何变换"
          defaultOpen
          actions={
            <button className="workspace-acc-reset" type="button" onClick={() => updatePipeline({ transform: createDefaultPipeline().transform })} title="重置几何变换">
              <RotateCcw size={11} />
            </button>
          }
        >
          <TransformPanel
            value={pipeline.transform}
            cropActive={cropActive}
            onChange={(transform) => updatePipeline({ transform })}
            onToggleCrop={() => (cropActive ? setCropActive(false) : startCrop())}
          />
        </Accordion>
          <ColorPanel
            value={pipeline.color}
            effects={pipeline.effects}
            onChange={(color) => updatePipeline({ color })}
            onEffectsChange={(effects) => updatePipeline({ effects })}
            onActivatePipette={() => setPipetteActive(true)}
          />
      </aside>

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
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!activeMedia} onClick={handleExport}>
            导出
          </Button>
        </div>
      </footer>

      <div className="workspace-media-strip">
        {media.map((item, index) => (
          <button
            key={item.id}
            className={`workspace-thumb${index === activeIndex ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveIndex(index)}
          >
            <span className="workspace-thumb-preview">
              {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.kind === 'video' ? '视频' : '图片'}</span>}
            </span>
            <span className="workspace-thumb-name">{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

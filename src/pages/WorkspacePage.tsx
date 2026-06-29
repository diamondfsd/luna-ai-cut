import { Download, Eye, EyeOff, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { ColorPanel } from '../workspace/color/ColorPanel'
import { EffectsPanel } from '../workspace/effects/EffectsPanel'
import { checkWebGLSupport, WebGLRenderer, workspaceImageCache } from '../workspace'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import { TransformPanel } from '../workspace/transform/TransformPanel'
import {
  createDefaultPipeline,
  DEFAULT_PIPELINE,
  mergePipeline,
  type PipelinePatch,
} from '../workspace/shared/editPipeline'
import { createEditHistory, pushHistory, redoHistory, resetHistory, undoHistory, type EditHistory } from '../workspace/shared/editHistory'
import { Accordion, Button, IconButton, Tooltip, toast } from '../ui'

export interface WorkspaceMediaAsset {
  id: string
  name: string
  path: string
  kind: 'image' | 'video'
  thumbnailUrl?: string | null
}

interface WorkspaceRouteState {
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

export function WorkspacePage() {
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null
  const initialMedia = useMemo(() => mediaFromState(routeState), [routeState])
  const [media, setMedia] = useState<WorkspaceMediaAsset[]>(initialMedia)
  const [activeIndex, setActiveIndex] = useState(routeState?.initialIndex ?? 0)
  const [history, setHistory] = useState<EditHistory>(() => createEditHistory(createDefaultPipeline()))
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [webglMessage, setWebglMessage] = useState<string | null>(null)
  const [cropActive, setCropActive] = useState(false)
  const [compareOriginal, setCompareOriginal] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const pipeline = history.present
  const activeMedia = media[activeIndex] ?? null

  useEffect(() => {
    if (!initialMedia.length) return
    setMedia(initialMedia)
    setActiveIndex(Math.min(routeState?.initialIndex ?? 0, initialMedia.length - 1))
  }, [initialMedia, routeState?.initialIndex])

  useEffect(() => {
    const support = checkWebGLSupport()
    if (!support.supported) {
      setWebglMessage(support.message ?? '当前设备不支持工作台渲染')
      return
    }
    setWebglMessage(support.message ?? null)
  }, [])

  useEffect(() => {
    if (!canvasRef.current || rendererRef.current || webglMessage?.includes('不支持')) return
    try {
      rendererRef.current = new WebGLRenderer(canvasRef.current)
    } catch (error) {
      setWebglMessage(error instanceof Error ? error.message : String(error))
    }
    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [webglMessage])

  useEffect(() => {
    if (!stageRef.current || !rendererRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      rendererRef.current?.resize(width, height)
      rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipeline)
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [compareOriginal, pipeline])

  useEffect(() => {
    if (!activeMedia || !rendererRef.current) return
    let canceled = false
    setImageLoading(true)
    setImageError(null)
    workspaceImageCache.generate(activeMedia.path)
      .then((entry) => {
        if (canceled) return
        rendererRef.current?.loadImage(entry.previewBitmap)
        rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipeline)
        setMedia((current) => current.map((item) => (
          item.path === activeMedia.path ? { ...item, thumbnailUrl: item.thumbnailUrl ?? entry.thumbnailUrl } : item
        )))
      })
      .catch((error) => {
        if (!canceled) setImageError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!canceled) setImageLoading(false)
      })
    return () => { canceled = true }
  }, [activeMedia, compareOriginal, pipeline])

  useEffect(() => {
    rendererRef.current?.render(compareOriginal ? DEFAULT_PIPELINE : pipeline)
  }, [compareOriginal, pipeline])

  const commitPatch = useCallback((patch: PipelinePatch) => {
    setHistory((current) => pushHistory(current, mergePipeline(current.present, patch)))
  }, [])

  function updatePipeline(patch: PipelinePatch): void {
    commitPatch(patch)
  }

  function handleUndo(): void {
    setHistory(undoHistory)
  }

  function handleRedo(): void {
    setHistory(redoHistory)
  }

  function handleReset(): void {
    setHistory((current) => resetHistory(current, createDefaultPipeline()))
    setCropActive(false)
  }

  function handleExport(): void {
    toast.show('工作台导出管线将在下一步接入')
  }

  const canRender = Boolean(rendererRef.current && activeMedia && !webglMessage?.includes('不支持'))

  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <span>工作台</span>
          <strong>{media.length}</strong>
        </div>
        <div className="workspace-media-list">
          {media.map((item, index) => (
            <button
              key={item.id}
              className={`workspace-thumb${index === activeIndex ? ' active' : ''}`}
              type="button"
              onClick={() => {
                setActiveIndex(index)
                setCropActive(false)
              }}
            >
              <span className="workspace-thumb-preview">
                {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.kind === 'video' ? '视频' : '图片'}</span>}
              </span>
              <span className="workspace-thumb-name">{item.name}</span>
            </button>
          ))}
          {media.length === 0 && (
            <div className="workspace-empty-list">
              从本地资源选择图片后发送到工作台
            </div>
          )}
        </div>
      </aside>

      <section className="workspace-canvas-shell">
        <div ref={stageRef} className="workspace-canvas-stage">
          <canvas ref={canvasRef} className="workspace-canvas" />
          {cropActive && canRender && (
            <CropOverlay
              crop={pipeline.transform.crop}
              onCropChange={(crop) => updatePipeline({ transform: { crop } })}
              onConfirm={() => setCropActive(false)}
              onCancel={() => {
                updatePipeline({ transform: { crop: null } })
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
        <Accordion title="几何变换" defaultOpen>
          <TransformPanel
            value={pipeline.transform}
            cropActive={cropActive}
            onChange={(transform) => updatePipeline({ transform })}
            onReset={() => updatePipeline({ transform: createDefaultPipeline().transform })}
            onToggleCrop={() => setCropActive((value) => !value)}
          />
        </Accordion>
        <Accordion title="调色" defaultOpen>
          <ColorPanel
            value={pipeline.color}
            onChange={(color) => updatePipeline({ color })}
            onReset={() => updatePipeline({ color: createDefaultPipeline().color })}
          />
        </Accordion>
        <Accordion title="效果" defaultOpen>
          <EffectsPanel
            value={pipeline.effects}
            onChange={(effects) => updatePipeline({ effects })}
            onReset={() => updatePipeline({ effects: createDefaultPipeline().effects })}
          />
        </Accordion>
      </aside>

      <footer className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Tooltip content="撤销">
            <IconButton variant="ghost" size="compact" icon={<Undo2 size={16} />} disabled={history.past.length === 0} onClick={handleUndo} />
          </Tooltip>
          <Tooltip content="重做">
            <IconButton variant="ghost" size="compact" icon={<Redo2 size={16} />} disabled={history.future.length === 0} onClick={handleRedo} />
          </Tooltip>
          <Button variant="ghost" size="mini" icon={<RotateCcw size={13} />} onClick={handleReset}>重置</Button>
        </div>
        <div className="workspace-toolbar-title">{activeMedia?.name ?? '未选择素材'}</div>
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
    </div>
  )
}

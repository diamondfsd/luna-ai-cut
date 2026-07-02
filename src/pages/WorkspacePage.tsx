import { ArrowLeft, ClipboardCopy, ClipboardPaste, Download, Eye, EyeOff, Pause, Play, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceProject } from '../shared/types'
import { Button, Dialog, ErrorBoundary, IconButton, LoadingIndicator, Tooltip, toast } from '../ui'
import { WorkspaceEditProvider, readWorkspacePipelineClipboard, useWorkspaceEdit, writeWorkspacePipelineClipboard } from '../workspace/context/WorkspaceEditContext'
import { WorkspaceMediaProvider, useWorkspaceMedia } from '../workspace/context/WorkspaceMediaContext'
import type { WorkspaceRouteState } from '../workspace/hooks/useProjectManager'
import { WorkspaceCanvasProvider, useWorkspaceCanvas } from '../workspace/context/WorkspaceCanvasContext'
import { useViewport } from '../workspace/hooks/useViewport'
import { useWorkspaceExport } from '../workspace/export/useWorkspaceExport'
import { createDefaultPipeline, mergePipeline } from '../workspace/shared/editPipeline'
import type { EditPipeline, PipelinePatch } from '../workspace/shared/editPipeline'
import { buildColorLutParams, colorLutKey } from '../workspace/shared/colorLut'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { WorkspaceWatermarkOverlay } from '../workspace/components/WorkspaceWatermarkOverlay'
import { WorkspaceEditSidebar } from '../workspace/components/WorkspaceEditSidebar'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import type { WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'
import '../styles/workspace-loading.css'

function normalizePipeline(value: unknown): EditPipeline {
  if (!value || typeof value !== 'object') return createDefaultPipeline()
  return mergePipeline(createDefaultPipeline(), value as PipelinePatch)
}

interface WorkspacePageProps {
  workspaceMode: WorkspaceMode
  pageActive: boolean
  onEditingChange?: (editing: boolean) => void
}

/** 格式化秒数为 mm:ss 或 hh:mm:ss */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function WorkspacePage({ workspaceMode, pageActive, onEditingChange }: WorkspacePageProps) {
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null

  return (
    <WorkspaceEditProvider>
      <WorkspaceMediaProvider routeState={routeState} locationKey={location.key}>
        <WorkspaceCanvasProvider>
          <ErrorBoundary>
            <WorkspacePageInner
              workspaceMode={workspaceMode}
              pageActive={pageActive}
              onEditingChange={onEditingChange}
            />
          </ErrorBoundary>
        </WorkspaceCanvasProvider>
      </WorkspaceMediaProvider>
    </WorkspaceEditProvider>
  )
}

// ── inner page that consumes all three contexts ──

function WorkspacePageInner({ workspaceMode, pageActive, onEditingChange }: WorkspacePageProps) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvas = useWorkspaceCanvas()
  const viewport = useViewport()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const activeMediaReady = Boolean(media.activeMedia && canvas.loadedMediaPath === media.activeMedia.path && !canvas.imageLoading)

  // ── 3D LUT 加载：color 参数变化时烘焙 LUT 并下发到 WebGL ──
  const lutTimerRef = useRef<number | null>(null)
  const lutKey = colorLutKey(edit.pipeline.color)
  useEffect(() => {
    if (!canvas.canRender) return
    if (lutTimerRef.current) window.clearTimeout(lutTimerRef.current)
    lutTimerRef.current = window.setTimeout(() => {
      const color = edit.pipeline.color
      if (!color) return
      void canvas.bakeAndLoadLut(buildColorLutParams(color), lutKey)
    }, 80)
    return () => {
      if (lutTimerRef.current) window.clearTimeout(lutTimerRef.current)
    }
  }, [
    lutKey,
    canvas.canRender,
    canvas.bakeAndLoadLut,
  ])

  // ── Export ──
  const exportImage = useWorkspaceExport({
    activeMedia: media.activeMedia,
    canvasRef: canvas.canvasRef,
    imageRect: canvas.imageRect,
    pipeline: edit.previewPipeline,
  })

  // ── 双击缩放 ──
  function handleStageDoubleClick(): void {
    if (edit.cropActive) return
    if (viewport.zoom > 1) {
      viewport.resetViewport()
    } else {
      viewport.zoomTo(2)
    }
  }

  // ── Reset viewport when media changes ──
  useEffect(() => {
    viewport.resetViewport()
  }, [media.activeMedia?.path])

  // ── Re-render canvas when pipeline / comparison / crop changes ──
  useEffect(() => {
    canvas.render(
      edit.compareOriginal ? edit.comparePipeline : edit.previewPipeline,
      { cropMode: edit.cropActive, allowStaleLut: !edit.compareOriginal },
    )
  }, [edit.compareOriginal, edit.previewPipeline, edit.comparePipeline, edit.cropActive, canvas.render])

  // ── Initialize pipeline / reset crop when active asset changes ──
  useEffect(() => {
    const asset = media.currentProject?.assets[media.activeIndex]
    edit.setCropActive(false)
    edit.setTransformDraft(null)
    edit.setCropPreset('original')
    edit.initializePipeline(normalizePipeline(asset?.pipeline))
  }, [media.activeIndex, media.currentProject?.id])

  // ── Auto-save project when pipeline changes ──
  const saveTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!media.currentProject || !media.activeMedia) return
    const nextProject: WorkspaceProject = {
      ...media.currentProject,
      assets: media.currentProject.assets.map((asset, index) =>
        index === media.activeIndex ? { ...asset, pipeline: edit.pipeline } : asset,
      ),
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      window.luna.workspace.saveProject(nextProject).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
      // 更新内存状态：切回图片时能保留修改后的参数
      media.setCurrentProject(nextProject)
    }, 500)
  }, [media.activeIndex, media.activeMedia?.path, media.currentProject?.id, edit.pipeline])

  // ── 批量重置 ──
  function handleBatchReset(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    if (indices.size === 1) {
      // 单个直接 reset
      edit.resetPipeline()
      toast.success('已重置到默认参数')
      return
    }
    // 批量重置：更新项目资源
    toast.success(`已重置 ${indices.size} 个素材到默认参数`)
    const defaultPipe = createDefaultPipeline()
    if (media.currentProject) {
      const nextAssets = media.currentProject.assets.map((asset, i) =>
        indices.has(i) ? { ...asset, pipeline: defaultPipe } : asset,
      )
      const nextProject = { ...media.currentProject, assets: nextAssets }
      media.setCurrentProject(nextProject)
      window.luna.workspace.saveProject(nextProject).catch(() => {})
      // 如果当前素材也在重置范围内，更新编辑历史
      if (indices.has(media.activeIndex)) {
        edit.resetPipeline()
      }
    } else {
      // transient media — 只重置当前
      edit.resetPipeline()
    }
  }

  function handlePastePipeline(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    if (indices.size === 1 && indices.has(media.activeIndex)) {
      edit.pasteToCurrent()
      return
    }

    const data = readWorkspacePipelineClipboard()
    if (!data) {
      toast.error('没有可粘贴的调色设置')
      return
    }
    const patch: PipelinePatch = {
      color: data.color,
      effects: data.effects,
      watermark: data.watermark,
    }

    if (media.currentProject) {
      const nextAssets = media.currentProject.assets.map((asset, i) => {
        if (!indices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline(asset.pipeline), patch)
        return { ...asset, pipeline: nextPipeline }
      })
      const nextProject = { ...media.currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
      media.setCurrentProject(nextProject)
      window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    } else {
      media.setTransientMedia((current) => current.map((asset, i) => {
        if (!indices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline((asset as { pipeline?: unknown }).pipeline), patch)
        return { ...asset, pipeline: nextPipeline }
      }))
    }

    if (indices.has(media.activeIndex)) {
      edit.commitPatch(patch)
    }
    toast.success(`已粘贴到 ${indices.size} 个素材`)
  }

  function handleCopyPipeline(): void {
    if (media.selectedIndices.size === 1) {
      const [selectedIndex] = [...media.selectedIndices]
      if (selectedIndex !== media.activeIndex) {
        const asset = media.media[selectedIndex]
        if (!asset) return
        const pipe = normalizePipeline((asset as { pipeline?: unknown }).pipeline)
        writeWorkspacePipelineClipboard({
          color: structuredClone(pipe.color),
          effects: structuredClone(pipe.effects),
          watermark: structuredClone(pipe.watermark),
        })
        toast.success('已复制调色和水印设置')
        return
      }
    }
    edit.copyPipeline()
  }

  // ── onEditingChange ──
  useEffect(() => {
    onEditingChange?.(media.editorOpen)
    return () => onEditingChange?.(false)
  }, [media.editorOpen, onEditingChange])

  // ── Keyboard shortcuts ──
  // Refs for values accessed in stable event listeners
  const cropActiveRef = useRef(false)
  const activeMediaRef = useRef(media.activeMedia)
  const mediaLengthRef = useRef(media.media.length)
  const selectedIndicesRef = useRef(new Set<number>())
  const copyPipelineRef = useRef(handleCopyPipeline)
  const pastePipelineRef = useRef(handlePastePipeline)
  const setCompareOriginalRef = useRef(edit.setCompareOriginal)

  // Sync refs with latest values
  useEffect(() => { cropActiveRef.current = edit.cropActive }, [edit.cropActive])
  useEffect(() => { activeMediaRef.current = media.activeMedia }, [media.activeMedia])
  useEffect(() => { mediaLengthRef.current = media.media.length }, [media.media.length])
  useEffect(() => { selectedIndicesRef.current = media.selectedIndices }, [media.selectedIndices])
  copyPipelineRef.current = handleCopyPipeline
  pastePipelineRef.current = handlePastePipeline
  setCompareOriginalRef.current = edit.setCompareOriginal

  // Stable keyboard handler (registered once, refs keep latest values)
  useEffect(() => {
    if (!pageActive || workspaceMode !== 'edit') return

    function handleKeyDown(event: KeyboardEvent): void {
      // 全局阻止空格默认行为（使用捕获阶段在滑块内部处理前拦截）
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
        if (!inInput && !cropActiveRef.current && activeMediaRef.current) {
          setCompareOriginalRef.current(true)
        }
        return
      }

      const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
      if (inInput) return
      const hasTextSelection = (window.getSelection()?.toString() ?? '').length > 0
      const workspaceStripActive = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('.workspace-media-strip'))

      if ((event.code === 'Delete' || event.code === 'Backspace') && activeMediaRef.current && !cropActiveRef.current) {
        const removalCount = selectedIndicesRef.current.size || 1
        if (removalCount >= mediaLengthRef.current) return
        event.preventDefault()
        setDeleteConfirmOpen(true)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && !cropActiveRef.current) {
        if (hasTextSelection || !workspaceStripActive) return
        if (event.target instanceof HTMLElement && event.target.closest('.workspace-video-progress')) return
        event.preventDefault()
        copyPipelineRef.current()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV' && !cropActiveRef.current) {
        if (hasTextSelection || !workspaceStripActive) return
        if (event.target instanceof HTMLElement && event.target.closest('.workspace-video-progress')) return
        event.preventDefault()
        pastePipelineRef.current()
        return
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        setCompareOriginalRef.current(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, [pageActive, workspaceMode])

  // ── Empty state ──
  if (!media.currentProject && media.media.length === 0) {
    return <WorkspaceProjectPicker />
  }

  return (
    <div className="workspace-layout">
      <section className="workspace-canvas-shell">
        <div
          ref={canvas.stageRef as React.RefObject<HTMLDivElement>}
          className={`workspace-canvas-stage${workspaceMode === 'creative' ? ' workspace-canvas-stage--hidden' : ''}${!activeMediaReady ? ' loading' : ''}${edit.cropActive ? ' cropping' : ''}${viewport.zoom > 1 && !edit.cropActive ? ' panning' : ''}`}
          onWheel={viewport.handleWheel}
          onPointerDown={viewport.handlePointerDown}
          onPointerMove={viewport.handlePointerMove}
          onPointerUp={viewport.handlePointerUp}
          onPointerCancel={viewport.handlePointerUp}
          onDoubleClick={handleStageDoubleClick}
        >
          <div
            className={`workspace-preview-surface${!activeMediaReady ? ' is-hidden' : ''}`}
            style={{ transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})` }}
          >
            <canvas ref={canvas.canvasRef as React.RefObject<HTMLCanvasElement>} className="workspace-canvas" />
            <WorkspaceWatermarkOverlay />
            {edit.cropActive && canvas.canRender && <CropOverlay />}
          </div>
          {/* Status overlay */}
          {(!activeMediaReady || canvas.imageError || canvas.webglMessage || !media.activeMedia) && (
            <div className="workspace-stage-status">
              {media.activeMedia && !canvas.imageError && !canvas.webglMessage && !activeMediaReady && (
                <LoadingIndicator label="加载预览中" />
              )}
              {canvas.imageError && <span>{canvas.imageError}</span>}
              {!canvas.imageError && canvas.webglMessage && <span>{canvas.webglMessage}</span>}
              {!canvas.imageError && !media.activeMedia && <span>暂无素材</span>}
            </div>
          )}
        </div>

        {/* 视频播放控件 */}
        {canvas.isVideo && activeMediaReady && (
          <>
            <div className="workspace-video-controls" onClick={(e) => e.stopPropagation()}>
              <button
                className="workspace-video-btn"
                type="button"
                onClick={canvas.toggleVideoPlayback}
                aria-label={canvas.videoPlaying ? '暂停' : '播放'}
              >
                {canvas.videoPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input
                className="workspace-video-progress"
                type="range"
                min={0}
                max={canvas.videoDuration || 1}
                step={0.1}
                value={canvas.videoCurrentTime}
                onChange={(e) => canvas.seekVideo(Number(e.target.value))}
                aria-label="进度"
              />
              <span className="workspace-video-time">
                {formatTime(canvas.videoCurrentTime)} / {formatTime(canvas.videoDuration)}
              </span>
            </div>
          </>
        )}
      </section>

      <WorkspaceEditSidebar />

      {/* ── Toolbar ── */}
      <footer className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Tooltip content="返回项目列表">
            <IconButton variant="ghost" size="compact" icon={<ArrowLeft size={16} />} onClick={media.backToProjects} />
          </Tooltip>
          <Tooltip content="撤销">
            <IconButton variant="ghost" size="compact" icon={<Undo2 size={16} />} disabled={!edit.canUndo} onClick={edit.undo} />
          </Tooltip>
          <Tooltip content="重做">
            <IconButton variant="ghost" size="compact" icon={<Redo2 size={16} />} disabled={!edit.canRedo} onClick={edit.redo} />
          </Tooltip>
          <Button variant="ghost" size="mini" icon={<RotateCcw size={13} />} onClick={handleBatchReset}>重置</Button>
          <div className="workspace-toolbar-divider" />
          <Tooltip content="复制调色和水印">
            <IconButton variant="ghost" size="compact" icon={<ClipboardCopy size={15} />} disabled={!media.activeMedia || !canvas.canRender} onClick={handleCopyPipeline} />
          </Tooltip>
          <Tooltip content="粘贴调色和水印到所选素材">
            <IconButton variant="ghost" size="compact" icon={<ClipboardPaste size={15} />} disabled={!media.activeMedia || !canvas.canRender} onClick={handlePastePipeline} />
          </Tooltip>
          {media.brokenPaths.size > 0 && (
            <>
              <div className="workspace-toolbar-divider" />
              <Button variant="danger" size="compact" icon={<Trash2 size={13} />} onClick={media.removeBrokenAssets}>
                移除 {media.brokenPaths.size} 个失效素材
              </Button>
            </>
          )}
        </div>
        <div className="workspace-toolbar-title">{media.currentProject?.name ?? '临时工作台'} · {media.activeIndex + 1}/{media.media.length}</div>
        <div className="workspace-toolbar-group">
          <Button
            variant={edit.compareOriginal ? 'primary' : 'secondary'}
            size="compact"
            icon={edit.compareOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
            onMouseDown={() => edit.setCompareOriginal(true)}
            onMouseUp={() => edit.setCompareOriginal(false)}
            onMouseLeave={() => edit.setCompareOriginal(false)}
          >
            对比
          </Button>
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!media.activeMedia || !canvas.canRender} onClick={() => void exportImage()}>
            导出
          </Button>
        </div>
      </footer>

      <WorkspaceMediaStrip />

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={media.selectedIndices.size > 1 ? `移除 ${media.selectedIndices.size} 个素材` : '移除此素材'}
        description={
          media.selectedIndices.size > 1
            ? `确定从工作台移除这 ${media.selectedIndices.size} 个素材？不会删除文件，只会从列表中移除。`
            : `确定从工作台移除「${media.activeMedia?.name ?? ''}」？不会删除文件，只会从列表中移除。`
        }
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="danger" size="compact" onClick={() => {
              if (media.selectedIndices.size > 1) {
                media.removeSelected(media.selectedIndices)
              } else {
                media.removeMedia(media.activeIndex)
              }
              setDeleteConfirmOpen(false)
            }}>移除</Button>
          </>
        }
      />
    </div>
  )
}

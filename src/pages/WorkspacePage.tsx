import { ArrowLeft, ClipboardCopy, ClipboardPaste, Download, Eye, EyeOff, LayoutTemplate, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceProject } from '../shared/types'
import { Button, Dialog, IconButton, Tooltip, toast } from '../ui'
import { WorkspaceEditProvider, useWorkspaceEdit } from '../workspace/context/WorkspaceEditContext'
import { WorkspaceMediaProvider, useWorkspaceMedia } from '../workspace/context/WorkspaceMediaContext'
import type { WorkspaceRouteState } from '../workspace/hooks/useProjectManager'
import { WorkspaceCanvasProvider, useWorkspaceCanvas } from '../workspace/context/WorkspaceCanvasContext'
import { useViewport } from '../workspace/hooks/useViewport'
import { useWorkspaceExport } from '../workspace/export/useWorkspaceExport'
import { createDefaultPipeline, mergePipeline } from '../workspace/shared/editPipeline'
import type { EditPipeline, PipelinePatch } from '../workspace/shared/editPipeline'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { WorkspaceWatermarkOverlay } from '../workspace/components/WorkspaceWatermarkOverlay'
import { WorkspaceEditSidebar } from '../workspace/components/WorkspaceEditSidebar'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import type { WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'

function normalizePipeline(value: unknown): EditPipeline {
  if (!value || typeof value !== 'object') return createDefaultPipeline()
  return mergePipeline(createDefaultPipeline(), value as PipelinePatch)
}

interface WorkspacePageProps {
  workspaceMode: WorkspaceMode
  onEditingChange?: (editing: boolean) => void
}

export function WorkspacePage({ workspaceMode, onEditingChange }: WorkspacePageProps) {
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null

  return (
    <WorkspaceEditProvider>
      <WorkspaceMediaProvider routeState={routeState} locationKey={location.key}>
        <WorkspaceCanvasProvider>
          <WorkspacePageInner
            workspaceMode={workspaceMode}
            onEditingChange={onEditingChange}
          />
        </WorkspaceCanvasProvider>
      </WorkspaceMediaProvider>
    </WorkspaceEditProvider>
  )
}

// ── inner page that consumes all three contexts ──

function WorkspacePageInner({ workspaceMode, onEditingChange }: WorkspacePageProps) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvas = useWorkspaceCanvas()
  const viewport = useViewport()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  // ── Export ──
  const exportImage = useWorkspaceExport({
    activeMedia: media.activeMedia,
    canvasRef: canvas.canvasRef,
    imageRect: canvas.imageRect,
    pipeline: edit.previewPipeline,
  })

  // ── Reset viewport when media changes ──
  useEffect(() => {
    viewport.resetViewport()
  }, [media.activeMedia?.path])

  // ── Re-render canvas when pipeline / comparison / crop changes ──
  useEffect(() => {
    canvas.render(
      edit.compareOriginal ? edit.comparePipeline : edit.previewPipeline,
      { cropMode: edit.cropActive },
    )
  }, [edit.compareOriginal, edit.previewPipeline, edit.comparePipeline, edit.cropActive, canvas.render, canvas.renderKey])

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
  const copyPipelineRef = useRef(edit.copyPipeline)
  const pasteToCurrentRef = useRef(edit.pasteToCurrent)
  const setCompareOriginalRef = useRef(edit.setCompareOriginal)

  // Sync refs with latest values
  useEffect(() => { cropActiveRef.current = edit.cropActive }, [edit.cropActive])
  useEffect(() => { activeMediaRef.current = media.activeMedia }, [media.activeMedia])
  useEffect(() => { mediaLengthRef.current = media.media.length }, [media.media.length])
  useEffect(() => { selectedIndicesRef.current = media.selectedIndices }, [media.selectedIndices])
  copyPipelineRef.current = edit.copyPipeline
  pasteToCurrentRef.current = edit.pasteToCurrent
  setCompareOriginalRef.current = edit.setCompareOriginal

  // Stable keyboard handler (registered once, refs keep latest values)
  useEffect(() => {
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

      if ((event.code === 'Delete' || event.code === 'Backspace') && activeMediaRef.current && !cropActiveRef.current) {
        const removalCount = selectedIndicesRef.current.size || 1
        if (removalCount >= mediaLengthRef.current) return
        event.preventDefault()
        setDeleteConfirmOpen(true)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyC' && !cropActiveRef.current) {
        event.preventDefault()
        copyPipelineRef.current()
        return
      }

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
        setCompareOriginalRef.current(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, [])

  // ── Empty state ──
  if (!media.currentProject && media.media.length === 0) {
    return <WorkspaceProjectPicker />
  }

  return (
    <div className="workspace-layout">
      <section className="workspace-canvas-shell">
        <div
          ref={canvas.stageRef as React.RefObject<HTMLDivElement>}
          className={`workspace-canvas-stage${workspaceMode === 'creative' ? ' workspace-canvas-stage--hidden' : ''}${edit.cropActive ? ' cropping' : ''}${viewport.zoom > 1 && !edit.cropActive ? ' panning' : ''}`}
          onWheel={viewport.handleWheel}
          onPointerDown={viewport.handlePointerDown}
          onPointerMove={viewport.handlePointerMove}
          onPointerUp={viewport.handlePointerUp}
          onPointerCancel={viewport.handlePointerUp}
        >
          <div
            className="workspace-preview-surface"
            style={{ transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})` }}
          >
            <canvas ref={canvas.canvasRef as React.RefObject<HTMLCanvasElement>} className="workspace-canvas" />
            <WorkspaceWatermarkOverlay />
            {edit.cropActive && canvas.canRender && <CropOverlay />}
          </div>
          {/* Status overlay */}
          {(canvas.imageLoading || canvas.imageError || canvas.webglMessage || !media.activeMedia) && (
            <div className="workspace-stage-status">
              {canvas.imageLoading && <span>加载预览中...</span>}
              {!canvas.imageLoading && canvas.imageError && <span>{canvas.imageError}</span>}
              {!canvas.imageLoading && !canvas.imageError && canvas.webglMessage?.includes('不支持') && <span>{canvas.webglMessage}</span>}
              {!canvas.imageLoading && !canvas.imageError && !media.activeMedia && <span>暂无素材</span>}
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

      {workspaceMode !== 'creative' && <WorkspaceEditSidebar />}

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
          <Button variant="ghost" size="mini" icon={<RotateCcw size={13} />} onClick={edit.resetPipeline}>重置</Button>
          <div className="workspace-toolbar-divider" />
          <Tooltip content="复制调色和水印">
            <IconButton variant="ghost" size="compact" icon={<ClipboardCopy size={15} />} disabled={!media.activeMedia || !canvas.canRender} onClick={edit.copyPipeline} />
          </Tooltip>
          <Tooltip content="粘贴调色和水印到当前图片">
            <IconButton variant="ghost" size="compact" icon={<ClipboardPaste size={15} />} disabled={!media.activeMedia || !canvas.canRender} onClick={edit.pasteToCurrent} />
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

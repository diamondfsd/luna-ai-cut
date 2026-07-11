import { ArrowLeft, ChevronDown, Eye, EyeOff, FileDown, ImagePlus, Maximize2, Minus, Plus, Redo2, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react'

import { Button, IconButton, Tooltip, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { createDefaultPipeline } from '../shared/editPipeline'
import './WorkspacePreviewToolbar.css'

export type WorkspaceViewScale = 'fit' | number

interface WorkspacePreviewToolbarProps {
  hasActiveMedia: boolean
  exportEnqueuing: boolean
  exportableSelectionCount: number
  exportButtonText: string
  onImport: () => void
  onExport: () => void
  viewScale: WorkspaceViewScale
  onViewScaleChange: (scale: WorkspaceViewScale) => void
}

export function WorkspacePreviewToolbar({
  hasActiveMedia,
  exportEnqueuing,
  exportableSelectionCount,
  exportButtonText,
  onImport,
  onExport,
  viewScale,
  onViewScaleChange,
}: WorkspacePreviewToolbarProps) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const scalePercent = viewScale === 'fit' ? null : viewScale

  function changeScale(delta: number): void {
    const current = scalePercent ?? 100
    onViewScaleChange(Math.max(25, Math.min(200, current + delta)))
  }

  async function saveProject(): Promise<void> {
    if (!media.currentProject) {
      toast.error('请先创建工作台项目')
      return
    }
    const project = {
      ...media.currentProject,
      assets: media.currentProject.assets.map((asset, index) => (
        index === media.activeIndex ? { ...asset, pipeline: edit.pipeline } : asset
      )),
      updatedAt: new Date().toISOString(),
    }
    await window.luna.workspace.saveProject(project)
    media.setCurrentProject(project)
    toast.success('项目已保存')
  }

  function resetAdjustments(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    if (indices.size === 1 && indices.has(media.activeIndex)) {
      edit.resetPipeline()
      toast.success('已重置当前素材')
      return
    }
    const defaultPipeline = createDefaultPipeline()
    if (!media.currentProject) {
      media.setTransientMedia((current) => current.map((asset, index) => (
        indices.has(index) ? { ...asset, pipeline: defaultPipeline } : asset
      )))
      if (indices.has(media.activeIndex)) edit.resetPipeline()
      toast.success(`已重置 ${indices.size} 个素材`)
      return
    }
    const project = {
      ...media.currentProject,
      assets: media.currentProject.assets.map((asset, index) => (
        indices.has(index) ? { ...asset, pipeline: defaultPipeline } : asset
      )),
      updatedAt: new Date().toISOString(),
    }
    media.setCurrentProject(project)
    void window.luna.workspace.saveProject(project)
    if (indices.has(media.activeIndex)) edit.resetPipeline()
    toast.success(`已重置 ${indices.size} 个素材`)
  }

  return (
    <header className="workspace-toolbar">
      <div className="workspace-toolbar-group workspace-toolbar-left">
        <Button variant="utility" size="compact" icon={<ArrowLeft size={15} />} onClick={media.backToProjects}>返回工作台</Button>
        <Button variant="utility" size="compact" icon={<ImagePlus size={14} />} onClick={onImport}>
          添加素材 <ChevronDown size={12} />
        </Button>
        <Button variant="utility" size="compact" icon={<RotateCcw size={14} />} onClick={resetAdjustments}>重置</Button>
        <div className="workspace-toolbar-divider" />
        <Tooltip content="撤销">
          <IconButton variant="ghost" size="compact" icon={<Undo2 size={16} />} disabled={!edit.canUndo} onClick={edit.undo} />
        </Tooltip>
        <Tooltip content="重做">
          <IconButton variant="ghost" size="compact" icon={<Redo2 size={16} />} disabled={!edit.canRedo} onClick={edit.redo} />
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
      <div className="workspace-zoom-control" aria-label="预览缩放">
        <IconButton variant="ghost" size="mini" icon={<Minus size={14} />} onClick={() => changeScale(-10)} aria-label="缩小预览" />
        <span>{scalePercent === null ? '适应' : `${scalePercent}%`}</span>
        <IconButton variant="ghost" size="mini" icon={<Plus size={14} />} onClick={() => changeScale(10)} aria-label="放大预览" />
        <div className="workspace-toolbar-divider" />
        <Tooltip content="适应窗口">
          <IconButton variant="ghost" size="mini" icon={<Maximize2 size={14} />} onClick={() => onViewScaleChange('fit')} />
        </Tooltip>
      </div>
      <div className="workspace-toolbar-group workspace-toolbar-actions">
        <Button
          variant={edit.compareOriginal ? 'primary' : 'utility'}
          size="compact"
          icon={edit.compareOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
          onMouseDown={() => edit.setCompareOriginal(true)}
          onMouseUp={() => edit.setCompareOriginal(false)}
          onMouseLeave={() => edit.setCompareOriginal(false)}
        >
          对比
        </Button>
        <Button variant="utility" size="compact" icon={<Save size={14} />} disabled={!media.currentProject} onClick={() => void saveProject()}>
          保存项目
        </Button>
        <Button
          variant="primary"
          size="compact"
          icon={<FileDown size={14} />}
          disabled={!hasActiveMedia || exportEnqueuing || exportableSelectionCount === 0}
          onClick={onExport}
        >
          {exportButtonText}
        </Button>
      </div>
    </header>
  )
}

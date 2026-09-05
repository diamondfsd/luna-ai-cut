import { ArrowLeft, ClipboardPaste, Copy, Eye, EyeOff, FileDown, Minus, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'

import { Button, IconButton, Select, Tooltip, toast } from '../../ui'
import type { WorkspacePreviewQuality } from '../../shared/types/settings'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { useDeviceConnection } from '../../context/DeviceConnectionContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { createWorkspaceDefaultPipeline } from '../shared/workspaceDefaultPipeline'
import { useApp } from '../../context/AppContext'
import { WorkspaceMediaImportButtons } from './WorkspaceMediaImportButtons'
import './WorkspacePreviewToolbar.css'

export type WorkspaceViewScale = 'fit' | number

interface WorkspacePreviewToolbarProps {
  hasActiveMedia: boolean
  exportEnqueuing: boolean
  exportableSelectionCount: number
  exportButtonText: string
  onImport: () => void
  onImportLocal: () => void
  onExport: () => void
  onCopy: () => void
  onPaste: () => void
  viewScale: WorkspaceViewScale
  onViewScaleChange: (scale: WorkspaceViewScale) => void
  fitScalePercent: number
  previewQuality: WorkspacePreviewQuality
  onPreviewQualityChange: (quality: WorkspacePreviewQuality) => void
}

export function WorkspacePreviewToolbar({
  hasActiveMedia,
  exportEnqueuing,
  exportableSelectionCount,
  exportButtonText,
  onImport,
  onImportLocal,
  onExport,
  onCopy,
  onPaste,
  viewScale,
  onViewScaleChange,
  fitScalePercent,
  previewQuality,
  onPreviewQualityChange,
}: WorkspacePreviewToolbarProps) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const mask = useWorkspaceMask()
  const { settings } = useApp()
  const { activeDevice, isConnected } = useDeviceConnection()
  const connectedDeviceMetadata = isConnected && activeDevice
    ? { sourceDeviceId: activeDevice.id, sourceDeviceName: activeDevice.name, cameraType: activeDevice.name, watermarkProfileId: activeDevice.id }
    : null
  const scalePercent = viewScale === 'fit' ? null : viewScale
  const currentScalePercent = scalePercent ?? fitScalePercent

  function changeScale(delta: number): void {
    onViewScaleChange(Math.max(5, Math.min(500, currentScalePercent + delta)))
  }

  function resetAdjustments(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    const defaultPipeline = createWorkspaceDefaultPipeline(settings, media.activeMedia, connectedDeviceMetadata)
    if (indices.size === 1 && indices.has(media.activeIndex)) {
      edit.resetPipeline(defaultPipeline)
      toast.success('已重置当前素材')
      return
    }
    if (!media.currentProject) {
      media.setTransientMedia((current) => current.map((asset, index) => (
        indices.has(index) ? { ...asset, pipeline: defaultPipeline } : asset
      )))
      if (indices.has(media.activeIndex)) edit.resetPipeline(defaultPipeline)
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
    if (indices.has(media.activeIndex)) edit.resetPipeline(defaultPipeline)
    toast.success(`已重置 ${indices.size} 个素材`)
  }

  return (
    <header className="workspace-toolbar">
      <div className="workspace-toolbar-group workspace-toolbar-left">
        <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={media.backToProjects}>返回工作台</Button>
        <WorkspaceMediaImportButtons onAddMedia={onImport} onImportLocal={onImportLocal} />
        <div className="workspace-toolbar-divider" />
        <Tooltip content="撤销">
          <IconButton variant="ghost" size="compact" icon={<Undo2 size={16} />} aria-label="撤销" disabled={!edit.canUndo || mask.busy} onClick={edit.undo} />
        </Tooltip>
        <Tooltip content="重做">
          <IconButton variant="ghost" size="compact" icon={<Redo2 size={16} />} aria-label="重做" disabled={!edit.canRedo || mask.busy} onClick={edit.redo} />
        </Tooltip>
        <div className="workspace-toolbar-divider" />
        <Tooltip content="复制效果">
          <IconButton variant="ghost" size="compact" icon={<Copy size={16} />} aria-label="复制效果" disabled={!hasActiveMedia} onClick={onCopy} />
        </Tooltip>
        <Tooltip content="粘贴效果">
          <IconButton variant="ghost" size="compact" icon={<ClipboardPaste size={16} />} aria-label="粘贴效果" onClick={onPaste} />
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
      <div className="workspace-toolbar-group workspace-toolbar-actions">
        <Select
          className="workspace-preview-quality"
          variant="compact"
          placeholder="预览清晰度，原图最高 4K"
          value={previewQuality}
          options={[
            { value: 'smooth', label: '流畅' },
            { value: 'balanced', label: '平衡' },
            { value: 'high', label: '高清' },
            { value: 'original', label: '原图' },
          ]}
          onValueChange={(value) => onPreviewQualityChange(value as WorkspacePreviewQuality)}
        />
        <div className="workspace-zoom-control" aria-label={`预览缩放，当前 ${currentScalePercent}%`}>
          <Tooltip content={`缩小（当前 ${currentScalePercent}%）`}>
            <IconButton variant="ghost" size="mini" icon={<Minus size={14} />} onClick={() => changeScale(-10)} aria-label="缩小预览" />
          </Tooltip>
          <Tooltip content={`恢复适应窗口（${fitScalePercent}%）`}>
            <Button
              className="workspace-zoom-value"
              variant="toolbar"
              size="mini"
              onClick={() => onViewScaleChange('fit')}
              aria-label={`当前缩放 ${currentScalePercent}%，点击恢复适应窗口`}
            >
              {currentScalePercent}%
            </Button>
          </Tooltip>
          <Tooltip content={`放大（当前 ${currentScalePercent}%）`}>
            <IconButton variant="ghost" size="mini" icon={<Plus size={14} />} onClick={() => changeScale(10)} aria-label="放大预览" />
          </Tooltip>
        </div>
        <div className="workspace-toolbar-divider" />
        <Button
          variant="toolbar"
          size="compact"
          icon={<RotateCcw size={14} />}
          disabled={!hasActiveMedia}
          onClick={resetAdjustments}
        >
          重置
        </Button>
        <Button
          variant={edit.compareOriginal ? 'toolbar-primary' : 'toolbar'}
          size="compact"
          icon={edit.compareOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
          onMouseDown={() => edit.setCompareOriginal(true)}
          onMouseUp={() => edit.setCompareOriginal(false)}
          onMouseLeave={() => edit.setCompareOriginal(false)}
        >
          对比
        </Button>
        <Button
          variant="toolbar-primary"
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

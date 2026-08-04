import { FolderOpen, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MediaGallery } from '../../components/MediaGallery'
import { PreviewModal } from '../../components/PreviewModal'
import type { LunaFile, WorkspaceMediaAsset } from '../../shared/types'
import { Button, Dialog, Input, toast } from '../../ui'
import { MediaLibraryCtx, useMediaLibraryController } from '../../pages/useMediaLibraryController'
import { chooseWorkspaceMediaAssets } from '../shared/workspaceLocalMedia'
import { filePathToPreviewUrl } from '../../lib/fileUtils'
import '../../styles/library.css'
import './WorkspaceImportDialog.css'

interface WorkspaceImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPaths: Set<string>
  onImport: (assets: WorkspaceMediaAsset[]) => void | Promise<void>
  mode?: 'import' | 'create'
  projectName?: string
  onProjectNameChange?: (value: string) => void
}

function groupTitle(group: string): string {
  if (group.includes('未知')) return group
  const date = new Date(`${group}T00:00:00`)
  const dateText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return `${dateText} ${weekday}`
}

function previewPath(file: LunaFile): string {
  return file.downloadFilePath ?? file.localPath ?? file.sourceUrl ?? file.id
}

export function WorkspaceImportDialog({
  open,
  onOpenChange,
  existingPaths,
  onImport,
  mode = 'import',
  projectName = '',
  onProjectNameChange,
}: WorkspaceImportDialogProps) {
  const controller = useMediaLibraryController('local')
  const [importing, setImporting] = useState(false)
  const creatingProject = mode === 'create'

  useEffect(() => {
    if (!open) return
    controller.setViewMode('download')
    controller.setSelected(new Set())
    void controller.loadDownloadedLibrary()
    // 仅在弹窗打开时刷新，controller 方法会随状态更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleImport(): Promise<void> {
    const importingPaths = new Set(existingPaths)
    const assets = controller.selectedFiles.reduce<WorkspaceMediaAsset[]>((result, file) => {
      const thumbnailPath = file.localPath ?? file.downloadFilePath ?? file.cacheFilePath
      const path = thumbnailPath
      if (!path || importingPaths.has(path) || (file.kind !== 'image' && file.kind !== 'video')) return result
      importingPaths.add(path)
      result.push({
        id: file.id,
        name: file.name,
        path,
        kind: file.kind,
        thumbnailUrl: thumbnailPath ? filePathToPreviewUrl(thumbnailPath) : null,
        isLivePhoto: file.isLivePhoto,
      })
      return result
    }, [])
    if (assets.length === 0) {
      toast.error('请选择尚未加入工作台的素材')
      return
    }
    setImporting(true)
    try {
      await onImport(assets)
      onOpenChange(false)
      toast.success(creatingProject ? `已创建项目，包含 ${assets.length} 个素材` : `已导入 ${assets.length} 个素材`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (creatingProject ? '创建项目失败' : '导入失败'))
    } finally {
      setImporting(false)
    }
  }

  async function handleChooseLocalFiles(): Promise<void> {
    try {
      const assets = await chooseWorkspaceMediaAssets(existingPaths)
      if (assets.length === 0) return
      setImporting(true)
      await onImport(assets)
      onOpenChange(false)
      toast.success(creatingProject ? `已创建项目，包含 ${assets.length} 个素材` : `已导入 ${assets.length} 个本地文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <MediaLibraryCtx.Provider value={controller}>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={creatingProject ? '新建项目' : '导入本地素材'}
        description={creatingProject ? '选择素材并预览，可填写标题后直接创建项目。' : undefined}
        tone="dark"
        className={`workspace-import-dialog${creatingProject ? ' workspace-create-project-dialog' : ''}`}
        footer={(
          <>
            <span className="workspace-import-count">已选择 {controller.selectedFiles.length} 个</span>
            <Button variant="secondary" size="compact" icon={<FolderOpen size={14} />} onClick={() => void handleChooseLocalFiles()} disabled={importing}>
              选择本地文件
            </Button>
            <Button variant="secondary" size="compact" onClick={() => onOpenChange(false)} disabled={importing}>取消</Button>
            <Button variant="primary" size="compact" icon={<Plus size={14} />} disabled={controller.selectedFiles.length === 0 || importing} onClick={() => void handleImport()}>
              {importing ? (creatingProject ? '创建中' : '导入中') : (creatingProject ? '创建并编辑' : '导入素材')}
            </Button>
          </>
        )}
      >
        <div className="workspace-import-body">
          {creatingProject && (
            <label className="workspace-create-project-title">
              <span>项目标题</span>
              <Input
                fullWidth
                value={projectName}
                onChange={(event) => onProjectNameChange?.(event.target.value)}
                placeholder="选填，不填则按素材数量自动生成"
                autoFocus
              />
            </label>
          )}
          <MediaGallery mode="local" groupTitle={groupTitle} />
        </div>
        {controller.previewFile && (
          <PreviewModal
            lightweightPreview
            previewOnly
            filePath={previewPath(controller.previewFile)}
            filePathList={controller.filteredFiles.map(previewPath)}
            isFileSelected={(filePath) => {
              const file = controller.filteredFiles.find((candidate) => previewPath(candidate) === filePath)
              return Boolean(file && controller.selected.has(file.id))
            }}
            onSetFileSelected={(filePath, selected) => {
              const file = controller.filteredFiles.find((candidate) => previewPath(candidate) === filePath)
              if (file && controller.selected.has(file.id) !== selected) controller.toggleFile(file)
            }}
            onClose={() => {
              controller.setPreviewFile(null)
              controller.setPreviewFiles([])
            }}
          />
        )}
      </Dialog>
    </MediaLibraryCtx.Provider>
  )
}

import { ArrowDownWideNarrow, ArrowUpWideNarrow, Download, Filter, FolderPlus, Loader2, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { showBatchExportModal } from './previewModalService'
import { DownloadProgressModal } from './DownloadProgressModal'
import { AddToWorkspaceProjectDialog, CreateWorkspaceProjectDialog } from './WorkspaceProjectDialogs'
import { formatBytes } from '../lib/format'
import { useApp } from '../context/AppContext'
import { useMediaLib } from '../pages/useMediaLibraryController'
import type { ViewMode } from '../pages/useMediaLibraryController'
import {
  Button,
  ButtonGroup,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  toast,
} from '../ui'
import type { WorkspaceProject } from '../shared/types'

interface MediaLibraryToolbarProps {
  mode: 'camera' | 'local'
  currentDate: string
}

export function MediaLibraryToolbar({ mode, currentDate }: MediaLibraryToolbarProps) {
  const isCamera = mode === 'camera'
  const isLocal = mode === 'local'
  const ctrl = useMediaLib()
  const { settings, downloadProgress, setDownloadProgress } = useApp()

  const haveSelection = ctrl.selectedFiles.length > 0
  const [filterOpen, setFilterOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const navigate = useNavigate()

  const workspaceMedia = ctrl.selectedFiles
    .filter((file) => file.kind === 'image' || file.kind === 'video')
    .map((file) => {
      const path = file.localPath ?? file.downloadFilePath ?? file.cacheFilePath ?? null
      if (!path) return null
      return {
        id: file.id,
        name: file.name,
        path,
        kind: file.kind as 'image' | 'video',
        isLivePhoto: file.isLivePhoto ?? false,
      }
    })
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
  const canSendToWorkspace = isLocal && workspaceMedia.length > 0

  async function handleCreateProject(): Promise<void> {
    if (!canSendToWorkspace || projectBusy) return
    setProjectBusy(true)
    try {
      const name = projectName.trim() || `工作台项目 ${new Date().toLocaleString()}`
      const project = await window.luna.workspace.createProject(name, workspaceMedia)
      setCreateProjectOpen(false)
      setProjectName('')
      ctrl.setSelected(new Set())
      navigate('/workspace', { state: { project, initialIndex: 0 } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectBusy(false)
    }
  }

  async function openAddProjectDialog(): Promise<void> {
    if (!canSendToWorkspace || projectBusy) return
    setProjectBusy(true)
    try {
      const nextProjects = await window.luna.workspace.listProjects()
      setProjects(nextProjects)
      setSelectedProjectId(nextProjects[0]?.id ?? '')
      setAddProjectOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectBusy(false)
    }
  }

  async function handleAddToProject(): Promise<void> {
    if (!selectedProjectId || projectBusy) return
    setProjectBusy(true)
    try {
      const project = await window.luna.workspace.addAssetsToProject(selectedProjectId, workspaceMedia)
      setAddProjectOpen(false)
      ctrl.setSelected(new Set())
      navigate('/workspace', { state: { project, initialIndex: Math.max(0, project.assets.length - workspaceMedia.length) } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectBusy(false)
    }
  }

  return (
    <>
      <section className="control-band">
        <div className={`library-tools${haveSelection ? ' is-selecting' : ''}`}>
          {haveSelection ? (
            <>
              <div className="selection-summary">
                已选择 <strong>{ctrl.selectedFiles.length}</strong> 个文件
              </div>
              <div className="library-controls">
                <Button variant="ghost" size="compact" onClick={() => ctrl.setSelected(new Set())}>
                  <X size={14} />
                  取消选择
                </Button>
                {isLocal ? (
                  <>
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!canSendToWorkspace}
                      icon={<FolderPlus size={14} />}
                      onClick={() => setCreateProjectOpen(true)}
                    >
                      创建项目 ({workspaceMedia.length})
                    </Button>
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!canSendToWorkspace || projectBusy}
                      icon={<Plus size={14} />}
                      onClick={() => void openAddProjectDialog()}
                    >
                      添加到项目
                    </Button>
                    <Button variant="danger" size="compact" onClick={() => ctrl.setShowDeleteDialog(true)}>
                      <Trash2 size={14} />
                      删除 ({ctrl.selectedFiles.length})
                    </Button>
                    <Button variant="primary" size="compact" onClick={() => {
                      const paths = ctrl.selectedFiles
                        .map((f) => f.downloadFilePath ?? f.localPath ?? '')
                        .filter(Boolean)
                      if (paths.length > 0) showBatchExportModal(paths[0], paths)
                    }}>
                      导出 ({ctrl.selectedFiles.length})
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary" size="compact"
                    onClick={() => void ctrl.startDownload()}
                    disabled={ctrl.downloading}
                    title={`下载已选素材，合计 ${formatBytes(ctrl.totalSelectedBytes)}`}
                    icon={ctrl.downloading ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                  >
                    下载 ({ctrl.selectedFiles.length})
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="toolbar-date">{currentDate}</span>
              <div className="library-controls">
                <ButtonGroup
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'image', label: '照片' },
                    { value: 'video', label: '视频' },
                  ]}
                  value={ctrl.mediaFilter}
                  onChange={(v) => ctrl.setMediaFilter(v as 'all' | 'image' | 'video')}
                />
                <button
                  className="ui-icon-btn ui-icon-btn-outline"
                  onClick={() => ctrl.setSortOrder((order) => (order === 'desc' ? 'asc' : 'desc'))}
                  title={ctrl.sortOrder === 'desc' ? '当前倒序，点击正序' : '当前正序，点击倒序'}
                  type="button"
                >
                  {ctrl.sortOrder === 'desc' ? <ArrowDownWideNarrow size={16} /> : <ArrowUpWideNarrow size={16} />}
                </button>
                <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                  <PopoverTrigger asChild>
                    <button className="ui-icon-btn ui-icon-btn-outline" type="button">
                      <Filter size={16} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={6}>
                    <div className="filter-popover">
                      <div data-popover-header>筛选</div>
                      <div className="filter-popover-body">
                        {isCamera && (
                          <>
                            <div className="filter-popover-row">
                              <span className="filter-popover-label">下载状态</span>
                              <SegmentedControl
                                ariaLabel="下载状态"
                                options={[
                                  { value: 'all', label: '全部' },
                                  { value: 'downloaded', label: '已下载' },
                                  { value: 'not-downloaded', label: '未下载' },
                                ]}
                                value={ctrl.downloadStatusFilter}
                                onChange={(v) => ctrl.setDownloadStatusFilter(v as 'all' | 'downloaded' | 'not-downloaded')}
                              />
                            </div>
                            {ctrl.storageOptions.length > 1 && (
                              <div className="filter-popover-row">
                                <span className="filter-popover-label">存储</span>
                                <SegmentedControl
                                  ariaLabel="选择存储"
                                  options={ctrl.storageOptions}
                                  value={ctrl.storageFilter}
                                  onChange={(value) => void ctrl.handleStorageFilterChange(value)}
                                />
                              </div>
                            )}
                          </>
                        )}
                        <div className="filter-popover-row">
                          <span className="filter-popover-label">卡片</span>
                          <SegmentedControl
                            ariaLabel="预览卡片大小"
                            options={[
                              { value: 'large', label: '大' },
                              { value: 'medium', label: '中' },
                              { value: 'small', label: '小' },
                            ]}
                            value={ctrl.cardSize}
                            onChange={(v) => ctrl.setCardSize(v as 'large' | 'medium' | 'small')}
                          />
                        </div>
                        {isLocal && (
                          <div className="filter-popover-row">
                            <span className="filter-popover-label">类型</span>
                            <SegmentedControl
                              options={[
                                { value: 'download', label: '已下载' },
                                { value: 'export', label: '已导出' },
                              ]}
                              value={ctrl.viewMode}
                              onChange={(v) => ctrl.setViewMode(v as ViewMode)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  className="ui-icon-btn ui-icon-btn-outline"
                  onClick={isLocal
                    ? (ctrl.viewMode === 'export' ? ctrl.loadExportLibrary : ctrl.loadDownloadedLibrary)
                    : ctrl.loadCameraLibrary
                  }
                  title={isLocal
                    ? (ctrl.viewMode === 'export' ? '刷新已导出' : '刷新已下载')
                    : '读取 Luna'
                  }
                  type="button"
                >
                  <RefreshCcw size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {isLocal && ctrl.deleteError && (
          <span className="export-error">
            {ctrl.deleteError}
            <button onClick={() => ctrl.setDeleteError(null)} title="关闭">&times;</button>
          </span>
        )}
        {isCamera && downloadProgress.size > 0 && (
          <DownloadProgressModal
            downloadDir={settings?.downloadDir}
            downloadQueue={ctrl.downloadQueue}
            downloadProgress={downloadProgress}
            activeFileNames={ctrl.activeDownloadFileNames}
            setDownloadProgress={setDownloadProgress}
            setDownloading={() => {/* downloading 已派生，不再需要显式设置 */}}
            onFileDownloaded={(fileName, path) => {
              ctrl.markFileDownloaded(fileName, path)
              void ctrl.restoreDownloadedRecords()
            }}
            onQueueClear={() => { ctrl.setDownloadQueue([]); ctrl.setActiveDownloadFileNames(new Set()) }}
            onQueueShift={(fileName) => { ctrl.setDownloadQueue((current) => current.filter((file) => file.name !== fileName)) }}
            onRevealFile={ctrl.revealFileByPath}
          />
        )}
      </section>

      <CreateWorkspaceProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        canCreate={canSendToWorkspace}
        busy={projectBusy}
        onConfirm={() => void handleCreateProject()}
      />

      <AddToWorkspaceProjectDialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectedProjectIdChange={setSelectedProjectId}
        busy={projectBusy}
        onConfirm={() => void handleAddToProject()}
      />

      {/* 导出弹窗已迁移到 PreviewModal（showBatchExportModal） */}
    </>
  )
}

import { ArrowDownWideNarrow, ArrowUpWideNarrow, Download, Filter, FolderPlus, Loader2, Plus, RefreshCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'

import { DownloadProgressModal } from './DownloadProgressModal'
import { ExportModal } from './ExportModal'
import { ExportProgressModal } from './ExportProgressModal'
import { formatBytes } from '../lib/format'
import type { CardSize, SortOrder } from '../pages/useMediaLibraryController'
import type { DeviceDefinition, DownloadProgress, ExportProgress, LunaFile, VideoExportSettings, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import {
  Button,
  ButtonGroup,
  Dialog,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  toast,
} from '../ui'
import type { WorkspaceProject } from '../shared/types'

type DownloadStatusFilter = 'all' | 'downloaded' | 'not-downloaded'
import type { ViewMode } from '../pages/useMediaLibraryController'

interface MediaLibraryToolbarProps {
  activeDevice?: DeviceDefinition
  activeDownloadFileNames: Set<string>
  cardSize: CardSize
  currentDate: string
  deleteError: string | null
  downloadProgress: Map<string, DownloadProgress>
  downloadQueue: LunaFile[]
  downloadDir: string | undefined
  downloading: boolean
  downloadStatusFilter: DownloadStatusFilter
  exportError: string | null
  exportProgress: Map<string, ExportProgress>
  exportSnapshots: Map<string, LunaFile>
  exporting: boolean
  exportWatermarkSettings: WatermarkSettingsType
  isDownloadsPage: boolean
  mediaFilter: 'all' | 'image' | 'video'
  selectedCount: number
  selectedFiles: LunaFile[]
  sortOrder: SortOrder
  storageFilter: string
  storageOptions: Array<{ value: string; label: string }>
  totalSelectedBytes: number
  viewMode: ViewMode
  setActiveDownloadFileNames: (value: Set<string>) => void
  setMediaFilter: (value: 'all' | 'image' | 'video') => void
  setCardSize: (value: CardSize) => void
  setDeleteError: (value: string | null) => void
  setDownloadProgress: Dispatch<SetStateAction<Map<string, DownloadProgress>>>
  setDownloadQueue: Dispatch<SetStateAction<LunaFile[]>>
  setDownloading: (downloading: boolean) => void
  setDownloadStatusFilter: (value: DownloadStatusFilter) => void
  setExportError: (value: string | null) => void
  setExporting: (value: boolean) => void
  setExportProgress: Dispatch<SetStateAction<Map<string, ExportProgress>>>
  setExportWatermarkSettings: (settings: WatermarkSettingsType) => void
  setSelected: Dispatch<SetStateAction<Set<string>>>
  setShowDeleteDialog: (value: boolean) => void
  setShowExportDialog: (value: boolean) => void
  setSortOrder: Dispatch<SetStateAction<SortOrder>>
  setViewMode: (value: ViewMode) => void
  showExportDialog: boolean
  startDownload: () => Promise<void>
  exportLocalFiles: (files: LunaFile[], settings: WatermarkSettingsType, videoSettings: VideoExportSettings) => Promise<void>
  handleStorageFilterChange: (value: string) => Promise<void>
  loadCameraLibrary: () => Promise<void>
  loadDownloadedLibrary: () => Promise<void>
  loadExportLibrary: () => Promise<void>
  markFileDownloaded: (fileName: string, path: string) => void
  restoreDownloadedRecords: () => Promise<void>
  revealFileByPath: (path: string) => void
}

export function MediaLibraryToolbar({
  activeDevice,
  activeDownloadFileNames,
  cardSize,
  currentDate,
  deleteError,
  downloadProgress,
  downloadQueue,
  downloadDir,
  downloading,
  downloadStatusFilter,
  exportError,
  exportProgress,
  exportSnapshots,
  exporting,
  exportWatermarkSettings,
  isDownloadsPage,
  mediaFilter,
  selectedCount,
  selectedFiles,
  sortOrder,
  storageFilter,
  storageOptions,
  totalSelectedBytes,
  viewMode,
  setActiveDownloadFileNames,
  setMediaFilter,
  setCardSize,
  setDeleteError,
  setDownloadProgress,
  setDownloadQueue,
  setDownloading,
  setDownloadStatusFilter,
  setExportError,
  setExporting,
  setExportProgress,
  setExportWatermarkSettings,
  setSelected,
  setShowDeleteDialog,
  setShowExportDialog,
  setSortOrder,
  setViewMode,
  showExportDialog,
  startDownload,
  exportLocalFiles,
  handleStorageFilterChange,
  loadCameraLibrary,
  loadDownloadedLibrary,
  loadExportLibrary,
  markFileDownloaded,
  restoreDownloadedRecords,
  revealFileByPath,
}: MediaLibraryToolbarProps) {
  const haveSelection = selectedCount > 0
  const [filterOpen, setFilterOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const navigate = useNavigate()
  const workspaceMedia = selectedFiles
    .filter((file) => file.kind === 'image')
    .map((file) => {
      const path = file.localPath ?? file.downloadFilePath ?? file.cacheFilePath ?? null
      if (!path) return null
      return {
        id: file.id,
        name: file.name,
        path,
        kind: 'image' as const,
        thumbnailUrl: file.thumbnailUrl,
      }
    })
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
  const canSendToWorkspace = isDownloadsPage && workspaceMedia.length > 0

  async function handleCreateProject(): Promise<void> {
    if (!canSendToWorkspace || projectBusy) return
    setProjectBusy(true)
    try {
      const name = projectName.trim() || `工作台项目 ${new Date().toLocaleString()}`
      const project = await window.luna.workspace.createProject(name, workspaceMedia)
      setCreateProjectOpen(false)
      setProjectName('')
      setSelected(new Set())
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
      setSelected(new Set())
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
                已选择 <strong>{selectedCount}</strong> 个文件
              </div>
              <div className="library-controls">
                <Button variant="ghost" size="compact" onClick={() => setSelected(new Set())}>
                  <X size={14} />
                  取消选择
                </Button>
                {isDownloadsPage ? (
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
                    <Button variant="danger" size="compact" onClick={() => setShowDeleteDialog(true)}>
                      <Trash2 size={14} />
                      删除 ({selectedCount})
                    </Button>
                    <Button variant="primary" size="compact" disabled={exporting} onClick={() => setShowExportDialog(true)}>
                      导出 ({selectedCount})
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary" size="compact"
                    onClick={() => void startDownload()}
                    disabled={downloading}
                    title={`下载已选素材，合计 ${formatBytes(totalSelectedBytes)}`}
                    icon={downloading ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                  >
                    下载 ({selectedCount})
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
                  value={mediaFilter}
                  onChange={setMediaFilter}
                />
                <button
                  className="ui-icon-btn ui-icon-btn-outline"
                  onClick={() => setSortOrder((order) => (order === 'desc' ? 'asc' : 'desc'))}
                  title={sortOrder === 'desc' ? '当前倒序，点击正序' : '当前正序，点击倒序'}
                  type="button"
                >
                  {sortOrder === 'desc' ? <ArrowDownWideNarrow size={16} /> : <ArrowUpWideNarrow size={16} />}
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
                        {!isDownloadsPage && (
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
                                value={downloadStatusFilter}
                                onChange={setDownloadStatusFilter}
                              />
                            </div>
                            {storageOptions.length > 1 && (
                              <div className="filter-popover-row">
                                <span className="filter-popover-label">存储</span>
                                <SegmentedControl
                                  ariaLabel="选择存储"
                                  options={storageOptions}
                                  value={storageFilter}
                                  onChange={(value) => void handleStorageFilterChange(value)}
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
                            value={cardSize}
                            onChange={setCardSize}
                          />
                        </div>
                        {isDownloadsPage && (
                          <div className="filter-popover-row">
                            <span className="filter-popover-label">类型</span>
                            <SegmentedControl
                              options={[
                                { value: 'download', label: '已下载' },
                                { value: 'export', label: '已导出' },
                              ]}
                              value={viewMode}
                              onChange={(v) => setViewMode(v as ViewMode)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  className="ui-icon-btn ui-icon-btn-outline"
                  onClick={isDownloadsPage ? (viewMode === 'export' ? loadExportLibrary : loadDownloadedLibrary) : loadCameraLibrary}
                  title={isDownloadsPage ? (viewMode === 'export' ? '刷新已导出' : '刷新已下载') : '读取 Luna'}
                  type="button"
                >
                  <RefreshCcw size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {isDownloadsPage && exportProgress.size > 0 && (
          <ExportProgressModal
            exportProgress={exportProgress}
            fileSnapshots={exportSnapshots}
            exporting={exporting}
            setExporting={setExporting}
            onRevealFile={revealFileByPath}
            onCanceled={() => {
              setExportProgress((current) => {
                const next = new Map(current)
                for (const [fileName, progress] of next.entries()) {
                  if (progress.status === 'queued' || progress.status === 'exporting') {
                    next.set(fileName, { ...progress, status: 'canceled', percent: null })
                  }
                }
                return next
              })
            }}
          />
        )}
        {isDownloadsPage && exportError && (
          <span className="export-error">{exportError}<button onClick={() => setExportError(null)} title="关闭">&times;</button></span>
        )}
        {isDownloadsPage && deleteError && (
          <span className="export-error">{deleteError}<button onClick={() => setDeleteError(null)} title="关闭">&times;</button></span>
        )}
        {!isDownloadsPage && downloadProgress.size > 0 && (
          <DownloadProgressModal
            downloadDir={downloadDir}
            downloadQueue={downloadQueue}
            downloadProgress={downloadProgress}
            activeFileNames={activeDownloadFileNames}
            setDownloadProgress={setDownloadProgress}
            setDownloading={setDownloading}
            onFileDownloaded={(fileName, path) => {
              markFileDownloaded(fileName, path)
              void restoreDownloadedRecords()
            }}
            onQueueClear={() => { setDownloadQueue([]); setActiveDownloadFileNames(new Set()) }}
            onQueueShift={(fileName) => { setDownloadQueue((current) => current.filter((file) => file.name !== fileName)) }}
            onRevealFile={revealFileByPath}
          />
        )}
      </section>

      <Dialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        title="创建工作台项目"
        description="项目会保存在本地资源目录，编辑参数写入项目 JSON。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateProjectOpen(false)}>取消</Button>
            <Button variant="primary" disabled={!canSendToWorkspace || projectBusy} icon={<Sparkles size={14} />} onClick={() => void handleCreateProject()}>
              创建并编辑
            </Button>
          </>
        }
      >
        <div className="workspace-dialog-body">
          <Input
            fullWidth
            value={projectName}
            placeholder="项目名称"
            onChange={(event) => setProjectName(event.target.value)}
          />
        </div>
      </Dialog>

      <Dialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
        title="添加到已有项目"
        description="选择一个工作台项目追加当前选中的图片。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddProjectOpen(false)}>取消</Button>
            <Button variant="primary" disabled={!selectedProjectId || projectBusy} onClick={() => void handleAddToProject()}>
              添加并编辑
            </Button>
          </>
        }
      >
        <div className="workspace-dialog-body">
          {projects.length > 0 ? (
            <Select
              fullWidth
              value={selectedProjectId}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              onValueChange={setSelectedProjectId}
            />
          ) : (
            <div className="workspace-dialog-empty">暂无项目，请先创建项目。</div>
          )}
        </div>
      </Dialog>

      {showExportDialog && (
        <ExportModal
          files={selectedFiles}
          watermarkSettings={exportWatermarkSettings}
          watermarkStyleOptions={activeDevice?.watermarkStyles}
          exporting={exporting}
          onClose={() => setShowExportDialog(false)}
          onConfirm={(settings, videoSettings) => { setShowExportDialog(false); void exportLocalFiles(selectedFiles, settings, videoSettings) }}
          onSettingsChange={setExportWatermarkSettings}
        />
      )}
    </>
  )
}

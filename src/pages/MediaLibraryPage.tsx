import { useEffect, useState } from 'react'

import { MediaGallery } from '../components/MediaGallery'
import { MediaLibraryToolbar } from '../components/MediaLibraryToolbar'
import { PreviewModal } from '../components/PreviewModal'
import { useMediaLibraryController, type MediaLibraryPageProps } from './useMediaLibraryController'
import { Modal, toast } from '../ui'
import '../styles/library.css'

/** 格式化日期，年月日和星期之间加空格 */
function formatDate(date: Date, showYear = false): string {
  const dateStr = new Intl.DateTimeFormat('zh-CN', {
    year: showYear ? 'numeric' : undefined,
    month: 'long',
    day: 'numeric',
  }).format(date)
  const weekdayStr = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return `${dateStr} ${weekdayStr}`
}

function groupTitle(group: string): string {
  if (group.includes('未知')) return group
  return formatDate(new Date(`${group}T00:00:00`))
}

export function MediaLibraryPage({
  isDownloadsPage,
  settings,
  downloadProgress,
  setDownloadProgress,
  downloading,
  setDownloading,
  previewFile,
  setPreviewFile,
  preview,
  setPreview,
  previewLoading,
  setPreviewLoading,
  activeDevice,
  refreshKey,
  selectMode,
  onSelect,
  pageActive = true,
}: MediaLibraryPageProps) {
  const {
    activeDownloadFileNames,
    autoPlayLiveFileId,
    cacheFailedIds,
    cardSize,
    deleteError,
    deletingLocalFiles,
    downloadQueue,
    downloadStatusFilter,
    exportError,
    exportProgress,
    exportSnapshots,
    exporting,
    exportWatermarkSettings,
    filteredFiles,
    groups,
    isCurrentLoading,
    mediaFilter,
    previewFiles,
    progressForPreview,
    selected,
    selectedFiles,
    showDeleteDialog,
    showExportDialog,
    sortOrder,
    storageFilter,
    storageOptions,
    totalSelectedBytes,
    viewMode,
    deleteSelectedLocalFiles,
    downloadOne,
    exportLocalFiles,
    handlePreviewClick,
    handleStorageFilterChange,
    handleThumbnailImageLoad,
    loadCameraLibrary,
    loadDownloadedLibrary,
    loadExportLibrary,
    markFileDownloaded,
    openPreview,
    restoreDownloadedRecords,
    revealDownloadedFile,
    revealFileByPath,
    setActiveDownloadFileNames,
    setCardSize,
    setDeleteError,
    setDownloadQueue,
    setDownloadStatusFilter,
    setExportError,
    setExporting,
    setExportProgress,
    setExportWatermarkSettings,
    setMediaFilter,
    setPreviewFiles,
    setSelected,
    setShowDeleteDialog,
    setShowExportDialog,
    setSortOrder,
    setViewMode,
    startDownload,
    toggleFile,
    toggleGroup,
  } = useMediaLibraryController({
    isDownloadsPage,
    settings,
    downloadProgress,
    setDownloadProgress,
    downloading,
    setDownloading,
    previewFile,
    setPreviewFile,
    preview,
    setPreview,
    previewLoading,
    setPreviewLoading,
    activeDevice,
    refreshKey,
    selectMode,
    onSelect,
  })
  const [currentDate, setCurrentDate] = useState(
    groups.length > 0
      ? formatDate(new Date(groups[0][0]), true)
      : ''
  )

  // 滚动时自动切换当前可见分组的日期
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.media-section[data-group]')
    if (els.length === 0) return

    const visible = new Map<Element, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target, entry.intersectionRatio)
        }
        // 找可见度最高的分区
        let best: Element | null = null
        let bestRatio = -1
        for (const [el, ratio] of visible) {
          if (ratio > bestRatio) { best = el; bestRatio = ratio }
        }
        if (best) {
          const group = best.getAttribute('data-group') || ''
          const formatted = formatDate(new Date(group), true)
          setCurrentDate(formatted)
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
    )

    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [groups])
  return (
    <>
      <MediaLibraryToolbar
        activeDevice={activeDevice}
        activeDownloadFileNames={activeDownloadFileNames}
        cardSize={cardSize}
        currentDate={currentDate}
        deleteError={deleteError}
        downloadDir={settings?.downloadDir}
        downloadProgress={downloadProgress}
        downloadQueue={downloadQueue}
        downloading={downloading}
        downloadStatusFilter={downloadStatusFilter}
        exportError={exportError}
        exportProgress={exportProgress}
        exportSnapshots={exportSnapshots}
        exporting={exporting}
        exportWatermarkSettings={exportWatermarkSettings}
        isDownloadsPage={isDownloadsPage}
        mediaFilter={mediaFilter}
        selectedCount={selectedFiles.length}
        selectedFiles={selectedFiles}
        sortOrder={sortOrder}
        storageFilter={storageFilter}
        storageOptions={storageOptions}
        totalSelectedBytes={totalSelectedBytes}
        viewMode={viewMode}
        setActiveDownloadFileNames={setActiveDownloadFileNames}
        setCardSize={setCardSize}
        setDeleteError={setDeleteError}
        setDownloadProgress={setDownloadProgress}
        setDownloadQueue={setDownloadQueue}
        setDownloading={setDownloading}
        setDownloadStatusFilter={setDownloadStatusFilter}
        setExportError={setExportError}
        setExporting={setExporting}
        setExportProgress={setExportProgress}
        setExportWatermarkSettings={setExportWatermarkSettings}
        setMediaFilter={setMediaFilter}
        setSelected={setSelected}
        setShowDeleteDialog={setShowDeleteDialog}
        setShowExportDialog={setShowExportDialog}
        setSortOrder={setSortOrder}
        setViewMode={setViewMode}
        showExportDialog={showExportDialog}
        startDownload={startDownload}
        exportLocalFiles={exportLocalFiles}
        handleStorageFilterChange={handleStorageFilterChange}
        loadCameraLibrary={loadCameraLibrary}
        loadDownloadedLibrary={loadDownloadedLibrary}
        loadExportLibrary={loadExportLibrary}
        markFileDownloaded={markFileDownloaded}
        restoreDownloadedRecords={restoreDownloadedRecords}
        revealFileByPath={revealFileByPath}
      />

      <MediaGallery
        cacheFailedIds={cacheFailedIds}
        cardSize={cardSize}
        downloadProgress={downloadProgress}
        filteredFiles={filteredFiles}
        groups={groups}
        isCurrentLoading={isCurrentLoading}
        isDownloadsPage={isDownloadsPage}
        selected={selected}
        selectedFiles={selectedFiles}
        selectMode={selectMode}
        groupTitle={groupTitle}
        handlePreviewClick={handlePreviewClick}
        handleThumbnailImageLoad={handleThumbnailImageLoad}
        onSelect={onSelect}
        revealDownloadedFile={revealDownloadedFile}
        revealFileByPath={revealFileByPath}
        toggleFile={toggleFile}
        toggleGroup={toggleGroup}
      />

      {pageActive && previewFile && !selectMode && (
        <PreviewModal
          files={previewFiles.length > 0 ? previewFiles : filteredFiles}
          currentFile={previewFile}
          currentFileId={previewFile.id}
          preview={preview}
          previewLoading={previewLoading}
          downloadProgress={progressForPreview}
          isDownloadsPage={isDownloadsPage}
          showWatermarkControls={isDownloadsPage && viewMode === 'download'}
          onClose={() => {
            setPreviewFile(null)
            setPreviewFiles([])
          }}
          onDownload={(file) => downloadOne(file)}
          onExportWithWatermark={(file, watermarkSettings) => {
            toast.success('已加入导出队列')
            void exportLocalFiles([file], { ...watermarkSettings, enabled: true })
          }}
          onReveal={(file) => {
            const localPath = file.downloadFilePath ?? file.localPath
            if (localPath) {
              revealFileByPath(localPath)
              return
            }
            revealDownloadedFile(downloadProgress.get(file.name))
          }}
          onFileChange={(file) => void openPreview(file, { keepPreviewFiles: true })}
          autoPlayLive={autoPlayLiveFileId === previewFile.id}
        />
      )}

      <Modal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="删除本地文件"
        description={`将删除已选的 ${selectedFiles.length} 个本地文件。这个操作不会删除相机中的原始素材。`}
        confirmText={deletingLocalFiles ? '删除中...' : '确认删除'}
        confirmVariant="danger"
        confirmDisabled={deletingLocalFiles}
        confirmLoading={deletingLocalFiles}
        onConfirm={() => void deleteSelectedLocalFiles()}
      >
        <p className="delete-dialog-copy">
          删除后文件会从本地资源列表中移除，正在预览的已删除文件也会关闭。
        </p>
      </Modal>
    </>
  )
}

import { FileQuestion } from 'lucide-react'

import { MediaCard } from './MediaCard'
import type { DownloadProgress, LunaFile } from '../shared/types'
import { Button, LoadingIndicator } from '../ui'

type CardSize = 'large' | 'medium' | 'small'

interface MediaGalleryProps {
  cacheFailedIds: Set<string>
  cardSize: CardSize
  downloadProgress: Map<string, DownloadProgress>
  filteredFiles: LunaFile[]
  groups: Array<[string, LunaFile[]]>
  isCurrentLoading: boolean
  isDownloadsPage: boolean
  selected: Set<string>
  selectedFiles: LunaFile[]
  selectMode?: boolean
  groupTitle: (group: string) => string
  handlePreviewClick: (file: LunaFile) => void
  handleThumbnailImageLoad: (file: LunaFile, localPath: string | null | undefined) => void
  onSelect?: (files: LunaFile[]) => void
  revealDownloadedFile: (progress: DownloadProgress | undefined) => void
  revealFileByPath: (path: string) => void
  toggleFile: (file: LunaFile) => void
  toggleGroup: (items: LunaFile[]) => void
}

export function MediaGallery({
  cacheFailedIds,
  cardSize,
  downloadProgress,
  filteredFiles,
  groups,
  isCurrentLoading,
  isDownloadsPage,
  selected,
  selectedFiles,
  selectMode,
  groupTitle,
  handlePreviewClick,
  handleThumbnailImageLoad,
  onSelect,
  revealDownloadedFile,
  revealFileByPath,
  toggleFile,
  toggleGroup,
}: MediaGalleryProps) {
  return (
    <div className="gallery">
      {isCurrentLoading && (
        <section className="loading-gallery">
          <LoadingIndicator size="large" label={isDownloadsPage ? '正在读取已下载文件' : '正在读取 Luna 媒体'} />
        </section>
      )}
      {groups.map(([group, items], _index) => (
        <section
          className="media-section"
          data-group={group}
          key={group}
        >
          <div className="section-heading">
            <h2>{groupTitle(group)}</h2>
            <div className="section-actions">
              <span className="file-count-chip">{items.length} 个文件</span>
              <Button variant="secondary" size="compact" onClick={() => toggleGroup(items)}>
                {items.every((file) => selected.has(file.id)) ? '取消选择' : '选择'}
              </Button>
              {selectMode && selectedFiles.length > 0 && (
                <Button variant="primary" size="compact" onClick={() => onSelect?.([...selectedFiles])}>
                  确认选择 ({selectedFiles.length})
                </Button>
              )}
            </div>
          </div>

          <div className={`media-grid card-size-${cardSize}`}>
            {items.map((file) => {
              const isSelected = selected.has(file.id)
              const progress = downloadProgress.get(file.name)
              const localPath = file.downloadFilePath ?? file.localPath
              return (
                <MediaCard
                  key={file.id}
                  file={file}
                  isDownloadsPage={isDownloadsPage}
                  selected={isSelected}
                  progress={progress}
                  cacheFailed={cacheFailedIds.has(file.id)}
                  selectVisible={!progress || !['queued', 'downloading', 'failed'].includes(progress.status) || Boolean(localPath && isSelected)}
                  onToggle={toggleFile}
                  onPreview={handlePreviewClick}
                  onRevealPath={revealFileByPath}
                  onRevealProgress={revealDownloadedFile}
                  onThumbnailLoad={handleThumbnailImageLoad}
                />
              )
            })}
          </div>
        </section>
      ))}
      {!isCurrentLoading && filteredFiles.length === 0 && (
        <section className="empty-gallery">
          <FileQuestion size={42} />
          <span>{isDownloadsPage ? '暂无已下载' : '暂无媒体'}</span>
        </section>
      )}
    </div>
  )
}

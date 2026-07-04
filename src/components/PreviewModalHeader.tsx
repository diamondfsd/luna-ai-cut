import type { CSSProperties } from 'react'
import { CircleAlert, Download, FolderOpen, Loader2, X } from 'lucide-react'

import type { DownloadProgress, LunaFile } from '../shared/types'
import { Button, IconButton } from '../ui'

interface PreviewModalHeaderProps {
  file: LunaFile
  downloadProgress?: DownloadProgress
  inspectorOpen?: boolean
  onClose: () => void
  onDownload?: (file: LunaFile) => void
  onReveal?: (file: LunaFile) => void
  onSetInspectorOpen?: (open: boolean) => void
}

function mediaLabel(file: LunaFile): string {
  if (file.kind === 'image') return '图片'
  if (file.kind === 'video') return '视频'
  return file.extension.toUpperCase() || '未知'
}

export function PreviewModalHeader({
  file,
  downloadProgress,
  inspectorOpen,
  onClose,
  onDownload,
  onReveal,
  onSetInspectorOpen,
}: PreviewModalHeaderProps) {
  const isDownloaded = !!file.downloadFilePath
  const isDownloadingCurrentFile = downloadProgress?.status === 'queued' || downloadProgress?.status === 'downloading'
  const progressPercent = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists' ? 100 : downloadProgress?.percent ?? 0
  const progressStyle = { '--progress': `${progressPercent * 3.6}deg` } as CSSProperties

  return (
    <header>
      <div>
        <span className="eyebrow">{mediaLabel(file)}</span>
        <h2>
          {file.name}
          {file.kind === 'video' && !isDownloaded && <span className="preview-tag">预览</span>}
        </h2>
      </div>
      <div className="preview-actions">
        {onDownload && (
          <Button
            variant="primary"
            size="compact"
            onClick={() => onDownload(file)}
            disabled={isDownloadingCurrentFile || isDownloaded}
            icon={isDownloadingCurrentFile ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
          >
            {isDownloaded ? '已下载' : '下载'}
          </Button>
        )}
        {isDownloaded && (
          <>
            {!inspectorOpen && (
              <IconButton
                variant="light"
                onClick={() => onSetInspectorOpen?.(true)}
                title="查看详细信息"
                icon={<CircleAlert size={15} />}
              />
            )}
            {onReveal && (
              <IconButton
                variant="light"
                onClick={() => onReveal(file)}
                title="在文件夹中显示"
                icon={<FolderOpen size={15} />}
              />
            )}
          </>
        )}
        {downloadProgress && downloadProgress.status !== 'done' && downloadProgress.status !== 'exists' && (
          <button
            className={`download-state preview-download-state ${downloadProgress.status}`}
            disabled
            style={progressStyle}
            title={
              downloadProgress.status === 'queued'
                ? '等待下载'
                : downloadProgress.status === 'canceled'
                  ? '已取消'
                  : '下载进度'
            }
          >
            {downloadProgress.status === 'failed' || downloadProgress.status === 'canceled' ? <X size={14} /> : null}
            {downloadProgress.status === 'queued' || downloadProgress.status === 'downloading' ? <span>{Math.round(progressPercent)}%</span> : null}
          </button>
        )}
        <IconButton variant="light" icon={<X size={18} />} onClick={onClose} title="关闭" />
      </div>
    </header>
  )
}

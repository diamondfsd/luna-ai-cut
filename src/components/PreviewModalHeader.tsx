import { useMemo } from 'react'
import { X, CircleAlert, FolderOpen, Download } from 'lucide-react'

import { IconButton } from '../ui'
import { extensionFromPath, fileNameFromPath, mediaKindFromPath } from '../lib/fileUtils'

interface PreviewModalHeaderProps {
  filePath: string
  inspectorOpen?: boolean
  onClose: () => void
  onSetInspectorOpen?: (open: boolean) => void
  /** 导出按钮回调 */
  onExport?: () => void
  /** 导出是否正在进行中 */
  exporting?: boolean
  /** 仅查看模式（隐藏导出按钮和水印配置入口） */
  previewOnly?: boolean
}

function mediaLabel(filePath: string): string {
  const kind = mediaKindFromPath(filePath)
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  return extensionFromPath(filePath).replace('.', '').toUpperCase() || '未知'
}

export function PreviewModalHeader({
  filePath,
  inspectorOpen,
  onClose,
  onSetInspectorOpen,
  onExport,
  exporting,
  previewOnly,
}: PreviewModalHeaderProps) {
  const revealPath = useMemo(
    () => filePath.startsWith('file://') ? decodeURIComponent(new URL(filePath).pathname) : filePath,
    [filePath],
  )

  function handleRevealInFolder() {
    if (revealPath) window.luna.revealFile(revealPath)
  }

  return (
    <header>
      <div>
        <span className="eyebrow">{mediaLabel(filePath)}</span>
        <h2>{fileNameFromPath(filePath)}</h2>
      </div>
      <div className="preview-actions">
        {!previewOnly && onExport && (
          <IconButton
            variant="light"
            icon={<Download size={16} />}
            onClick={onExport}
            disabled={exporting}
            title={exporting ? '导出中...' : '导出当前帧'}
          />
        )}
        {!inspectorOpen && (
          <IconButton
            variant="light"
            onClick={() => onSetInspectorOpen?.(true)}
            title="查看详细信息"
            icon={<CircleAlert size={15} />}
          />
        )}
        {revealPath && (
          <IconButton
            variant="light"
            icon={<FolderOpen size={16} />}
            onClick={handleRevealInFolder}
            title="在文件夹中显示"
          />
        )}
        <IconButton variant="light" icon={<X size={18} />} onClick={onClose} title="关闭" />
      </div>
    </header>
  )
}

import { useMemo } from 'react'
import { X, CircleAlert, FolderOpen } from 'lucide-react'

import { IconButton } from '../ui'
import { extensionFromPath, fileNameFromPath, mediaKindFromPath } from '../lib/fileUtils'

interface PreviewModalHeaderProps {
  filePath: string
  inspectorOpen?: boolean
  onClose: () => void
  onSetInspectorOpen?: (open: boolean) => void
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

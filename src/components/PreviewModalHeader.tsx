import { useMemo } from 'react'
import { X, CircleAlert, FolderOpen, Download } from 'lucide-react'

import type { LunaFile } from '../shared/types'
import { IconButton } from '../ui'

interface PreviewModalHeaderProps {
  file: LunaFile
  inspectorOpen?: boolean
  onClose: () => void
  onSetInspectorOpen?: (open: boolean) => void
  /** 导出按钮回调 */
  onExport?: () => void
  /** 导出是否正在进行中 */
  exporting?: boolean
}

function mediaLabel(file: LunaFile): string {
  if (file.kind === 'image') return '图片'
  if (file.kind === 'video') return '视频'
  return file.extension.toUpperCase() || '未知'
}

export function PreviewModalHeader({
  file,
  inspectorOpen,
  onClose,
  onSetInspectorOpen,
  onExport,
  exporting,
}: PreviewModalHeaderProps) {
  const revealPath = useMemo(
    () => file.downloadFilePath ?? file.localPath ?? null,
    [file.downloadFilePath, file.localPath],
  )

  function handleRevealInFolder() {
    if (revealPath) window.luna.revealFile(revealPath)
  }

  return (
    <header>
      <div>
        <span className="eyebrow">{mediaLabel(file)}</span>
        <h2>{file.name}</h2>
      </div>
      <div className="preview-actions">
        {onExport && (
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

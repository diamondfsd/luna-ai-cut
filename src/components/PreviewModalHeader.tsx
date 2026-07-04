import { X, CircleAlert } from 'lucide-react'

import type { LunaFile } from '../shared/types'
import { IconButton } from '../ui'

interface PreviewModalHeaderProps {
  file: LunaFile
  inspectorOpen?: boolean
  onClose: () => void
  onSetInspectorOpen?: (open: boolean) => void
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
}: PreviewModalHeaderProps) {
  return (
    <header>
      <div>
        <span className="eyebrow">{mediaLabel(file)}</span>
        <h2>{file.name}</h2>
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
        <IconButton variant="light" icon={<X size={18} />} onClick={onClose} title="关闭" />
      </div>
    </header>
  )
}

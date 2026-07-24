import { ImageOff } from 'lucide-react'

import '../../styles/workspace-missing-media.css'

interface WorkspaceMissingMediaProps {
  compact?: boolean
}

export function WorkspaceMissingMedia({ compact = false }: WorkspaceMissingMediaProps) {
  return (
    <span className={`workspace-missing-media${compact ? ' compact' : ''}`} role="status" aria-label="文件不存在">
      <ImageOff size={compact ? 15 : 19} />
      <span>文件不存在</span>
    </span>
  )
}

import { FileUp, ImagePlus } from 'lucide-react'

import { Button } from '../../ui'

interface WorkspaceMediaImportButtonsProps {
  onAddMedia: () => void
  onImportLocal: () => void
}

export function WorkspaceMediaImportButtons({ onAddMedia, onImportLocal }: WorkspaceMediaImportButtonsProps) {
  return <>
    <Button variant="toolbar" size="compact" icon={<ImagePlus size={14} />} onClick={onAddMedia}>
      添加素材
    </Button>
    <Button variant="toolbar" size="compact" icon={<FileUp size={14} />} onClick={onImportLocal}>
      导入
    </Button>
  </>
}

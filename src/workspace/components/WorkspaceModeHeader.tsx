import '../../styles/workspace-mode.css'
import { getCreativeCatalogItem, type CreativeModeId } from '../creative/creativeCatalog'

export type WorkspaceMode = 'edit' | 'creative'
export type { CreativeModeId } from '../creative/creativeCatalog'

interface WorkspaceModeHeaderProps {
  mode: WorkspaceMode
  creativeModeId: CreativeModeId | null
  onModeChange: (mode: WorkspaceMode) => void
  onCreativeModeChange: (modeId: CreativeModeId | null) => void
  variant?: 'header' | 'nav'
}

export function WorkspaceModeHeader({
  mode,
  creativeModeId,
  onModeChange,
  onCreativeModeChange,
  variant = 'header',
}: WorkspaceModeHeaderProps) {
  const activeCreative = getCreativeCatalogItem(creativeModeId)
  const switcher = (
    <div className="workspace-mode-switcher">
      <button
        className={`workspace-mode-btn${mode === 'edit' ? ' active' : ''}`}
        onClick={() => onModeChange('edit')}
      >
        编辑
      </button>
      <button
        className={`workspace-mode-btn workspace-mode-btn-creative${mode === 'creative' ? ' active' : ''}`}
        onClick={() => {
          onCreativeModeChange(null)
          onModeChange('creative')
        }}
      >
        创意
      </button>
    </div>
  )

  if (variant === 'nav') {
    return switcher
  }

  return (
    <header className="workspace-mode-header">
      {switcher}
      {mode === 'creative' && activeCreative && (
        <span className="workspace-mode-subtitle">{activeCreative.subtitle}</span>
      )}
    </header>
  )
}

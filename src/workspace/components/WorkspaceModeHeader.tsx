import '../../styles/workspace-mode.css'

export type WorkspaceMode = 'edit' | 'creative'
export type CreativeModeId = 'triple-stitch'

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
          onCreativeModeChange('triple-stitch')
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
      {mode === 'creative' && creativeModeId === 'triple-stitch' && (
        <span className="workspace-mode-subtitle">三拼视频</span>
      )}
    </header>
  )
}

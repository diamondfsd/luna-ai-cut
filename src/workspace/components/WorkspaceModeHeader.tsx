import { ChevronDown, Clapperboard, LayoutTemplate, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '../../ui'
import '../../styles/workspace-mode.css'

export type WorkspaceMode = 'edit' | 'creative'
export type CreativeModeId = 'triple-stitch'

interface CreativeOption {
  id: CreativeModeId | string
  name: string
  icon: React.ReactNode
  description: string
  comingSoon?: boolean
}

const CREATIVE_OPTIONS: CreativeOption[] = [
  { id: 'triple-stitch', name: 'Live 三拼', icon: <LayoutTemplate size={18} />, description: '将三张竖版 Live 图或视频上下拼接为一张 Live Photo' },
  { id: 'luna-intro', name: 'Luna 片头', icon: <Clapperboard size={18} />, description: '为视频添加渐变品牌开场动画', comingSoon: true },
  { id: 'more', name: '更多创意', icon: <Sparkles size={18} />, description: '更多创意模式即将推出', comingSoon: true },
]

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
  const [popoverOpen, setPopoverOpen] = useState(false)

  const selectedCreative = CREATIVE_OPTIONS.find((opt) => opt.id === creativeModeId)

  const switcher = (
    <div className="workspace-mode-switcher">
      <button
        className={`workspace-mode-btn${mode === 'edit' ? ' active' : ''}`}
        onClick={() => onModeChange('edit')}
      >
        编辑
      </button>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button className={`workspace-mode-btn workspace-mode-btn-creative${mode === 'creative' ? ' active' : ''}`}>
            创意
            <ChevronDown size={14} className="workspace-mode-chevron" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8}>
          <div className="workspace-creative-menu">
            <div className="workspace-creative-menu-header">创意模式</div>
            {CREATIVE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`workspace-creative-option${selectedCreative?.id === opt.id ? ' selected' : ''}${opt.comingSoon ? ' coming-soon' : ''}`}
                disabled={opt.comingSoon}
                onClick={() => {
                  if (opt.comingSoon) return
                  onCreativeModeChange(opt.id as CreativeModeId)
                  onModeChange('creative')
                  setPopoverOpen(false)
                }}
              >
                <span className="workspace-creative-option-icon">{opt.icon}</span>
                <span className="workspace-creative-option-info">
                  <span className="workspace-creative-option-name">{opt.name}</span>
                  <span className="workspace-creative-option-desc">{opt.description}</span>
                </span>
                {opt.comingSoon && <span className="workspace-creative-option-badge">即将推出</span>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )

  if (variant === 'nav') {
    return switcher
  }

  return (
    <header className="workspace-mode-header">
      {switcher}
      {mode === 'creative' && selectedCreative && (
        <span className="workspace-mode-subtitle">{selectedCreative.name}</span>
      )}
    </header>
  )
}

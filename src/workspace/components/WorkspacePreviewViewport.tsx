import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

import { IconButton } from '../../ui'
import './WorkspacePreviewViewport.css'

interface WorkspacePreviewViewportProps {
  immersive: boolean
  disabled?: boolean
  onToggleImmersive: () => void
  children: ReactNode
}

export function WorkspacePreviewViewport({ immersive, disabled = false, onToggleImmersive, children }: WorkspacePreviewViewportProps) {
  const [navigationVisible, setNavigationVisible] = useState(false)
  const navigationHideTimerRef = useRef<number | null>(null)

  const revealNavigation = useCallback(() => {
    setNavigationVisible(true)
    if (navigationHideTimerRef.current !== null) window.clearTimeout(navigationHideTimerRef.current)
    navigationHideTimerRef.current = window.setTimeout(() => {
      navigationHideTimerRef.current = null
      setNavigationVisible(false)
    }, 1800)
  }, [])

  const hideNavigation = useCallback(() => {
    if (navigationHideTimerRef.current !== null) {
      window.clearTimeout(navigationHideTimerRef.current)
      navigationHideTimerRef.current = null
    }
    setNavigationVisible(false)
  }, [])

  useEffect(() => hideNavigation, [hideNavigation])

  return (
    <div
      className={`workspace-preview-shell${navigationVisible ? ' navigation-visible' : ''}`}
      onMouseMove={revealNavigation}
      onMouseLeave={hideNavigation}
    >
      <IconButton
        variant="light"
        className={`workspace-preview-fullscreen-toggle${navigationVisible ? ' is-visible' : ''}`}
        icon={immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        onClick={onToggleImmersive}
        disabled={disabled}
        title={immersive ? '退出全屏' : '全屏预览'}
        aria-label={immersive ? '退出全屏' : '全屏预览'}
        aria-pressed={immersive}
      />
      {children}
    </div>
  )
}

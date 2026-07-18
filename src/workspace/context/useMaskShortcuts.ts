import { useEffect } from 'react'

import type { MaskManualTool } from './WorkspaceMaskContextTypes'

interface Options {
  editing: boolean
  busy: boolean
  semanticPicking: boolean
  hasActiveComponent: boolean
  cancelSegmentation: () => void
  removeActiveComponent: () => Promise<void>
  setSemanticPicking: (value: boolean) => void
  setManualTool: (tool: MaskManualTool) => void
  setShowOverlay: (update: (visible: boolean) => boolean) => void
  setBrushSize: (update: (size: number) => number) => void
  setBrushFeather: (update: (feather: number) => number) => void
}

export function useMaskShortcuts(options: Options): void {
  const {
    editing, busy, semanticPicking, hasActiveComponent, cancelSegmentation,
    removeActiveComponent, setSemanticPicking, setManualTool, setShowOverlay, setBrushSize, setBrushFeather,
  } = options
  useEffect(() => {
    if (!editing) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return
      if (event.code === 'KeyO') {
        event.preventDefault()
        setShowOverlay((visible) => !visible)
        return
      }
      if (event.code === 'Escape') {
        event.preventDefault()
        if (semanticPicking && busy) cancelSegmentation()
        setSemanticPicking(false)
        setManualTool('move')
        return
      }
      if (busy) return
      if ((event.code === 'Delete' || event.code === 'Backspace') && hasActiveComponent) {
        event.preventDefault()
        void removeActiveComponent()
        return
      }
      if (event.code === 'KeyK') setManualTool('brush')
      else if (event.code === 'KeyM') setManualTool(event.shiftKey ? 'radial-gradient' : 'linear-gradient')
      else if (event.code === 'Enter') setManualTool('move')
      else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        const direction = event.code === 'BracketLeft' ? -1 : 1
        if (event.shiftKey) setBrushFeather((feather) => Math.max(0, Math.min(100, feather + direction * 5)))
        else setBrushSize((size) => Math.max(1, Math.min(100, size + direction * 4)))
      } else return
      event.preventDefault()
      setSemanticPicking(false)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [busy, cancelSegmentation, editing, hasActiveComponent, removeActiveComponent, semanticPicking, setBrushFeather, setBrushSize, setManualTool, setSemanticPicking, setShowOverlay])
}

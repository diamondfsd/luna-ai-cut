import { createRoot } from 'react-dom/client'
import App from '../App'
import { useTimelineStore } from '../stores/timeline-store'
import { useThemeStore } from '../stores/theme-store'
import { AstryxProvider } from '../components/astryx/AstryxProvider'
import { initCustomFonts } from '../components/editor/inspector/font-options'
import { setEmbeddedRoot, setEditorHash } from './embedded-runtime'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import '../index.css'
import './embedded.css'

export function mount(element: HTMLElement) {
  element.classList.add('luna-openreel')
  element.tabIndex = -1
  const focusEditor = (event: PointerEvent) => {
    if (event.target instanceof HTMLElement && !event.target.closest('input,textarea,button,select,[contenteditable=true]')) element.focus({ preventScroll: true })
  }
  element.addEventListener('pointerdown', focusEditor)
  setEmbeddedRoot(element)
  ;(globalThis as typeof globalThis & { __lunaOpenreelRoot?: HTMLElement }).__lunaOpenreelRoot = element
  useThemeStore.getState().setMode(useThemeStore.getState().mode)
  void initCustomFonts()
  const root = createRoot(element)
  root.render(<AstryxProvider><App /></AstryxProvider>)
  return {
    setActive(active: boolean) { if (!active) useTimelineStore.getState().pause() },
    openProject(projectId?: string) {
      setEditorHash(projectId ? `#/luna-editor?projectId=${encodeURIComponent(projectId)}` : '#/projects')
    },
    dispose() { element.removeEventListener('pointerdown', focusEditor); root.unmount(); setEmbeddedRoot(null); delete (globalThis as typeof globalThis & { __lunaOpenreelRoot?: HTMLElement }).__lunaOpenreelRoot },
  }
}

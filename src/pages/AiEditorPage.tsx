import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiEditorMediaSource } from '../shared/aiEditor'
import type { WorkspaceMediaAsset } from '../shared/types'
import { loadOpenReelComponent, type OpenReelComponent } from './openreelComponent'
import './AiEditorPage.css'

interface AiEditorLocationState {
  projectId?: string | null
  media?: AiEditorMediaSource[]
}

function isMediaSource(value: unknown): value is AiEditorMediaSource {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<AiEditorMediaSource>
  return typeof source.path === 'string'
    && typeof source.name === 'string'
    && (source.kind === 'image' || source.kind === 'video')
}

export function AiEditorPage({ active }: { active: boolean }): JSX.Element {
  const location = useLocation()
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<OpenReelComponent | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const pendingProject = useRef<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(globalThis as typeof globalThis & { __lunaOpenreelRoot?: HTMLElement }).__lunaOpenreelRoot = container.current ?? undefined
    void loadOpenReelComponent().then(module => {
      if (cancelled || !container.current) return
      editor.current = module.mount(container.current)
      editor.current.setActive(activeRef.current)
      editor.current.openProject(pendingProject.current ?? undefined)
    }).catch(() => { if (!cancelled) setError('打开失败') })
    return () => { cancelled = true; editor.current?.dispose(); editor.current = null }
  }, [])

  useEffect(() => { editor.current?.setActive(active) }, [active])

  const openedLocationKey = useRef<string | null>(null)
  useEffect(() => {
    if (!active || location.pathname !== '/ai-editor' || openedLocationKey.current === location.key) return
    const previouslyOpened = openedLocationKey.current !== null
    openedLocationKey.current = location.key
    const state = location.state as AiEditorLocationState | null
    if (state && 'projectId' in state) {
      pendingProject.current = state.projectId ?? null
      editor.current?.openProject(state.projectId ?? undefined)
      return
    }
    const media = state?.media
    if (previouslyOpened && !media?.length) return
    const assets: WorkspaceMediaAsset[] = Array.isArray(media)
      ? media.filter(isMediaSource).map(source => ({
        id: `${source.path}:${source.name}`, name: source.name,
        path: source.path, kind: source.kind, thumbnailUrl: null,
      })) : []
    void window.luna.aiEditor.openWindow(assets).catch(() => setError('打开失败'))
  }, [active, location.key, location.pathname, location.state])

  return (
    <div className="ai-editor-page">
      {error && <span role="status">{error}</span>}
      <div ref={container} className="ai-editor-component" />
    </div>
  )
}

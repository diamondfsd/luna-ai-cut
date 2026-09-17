import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiEditorMediaSource } from '../shared/aiEditor'
import type { WorkspaceMediaAsset } from '../shared/types'
import './AiEditorPage.css'

interface AiEditorLocationState {
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
  const openedLocationKey = useRef<string | null>(null)

  useEffect(() => {
    if (!active || location.pathname !== '/ai-editor' || openedLocationKey.current === location.key) return
    openedLocationKey.current = location.key
    const state = location.state as AiEditorLocationState | null
    const media = state?.media
    const assets: WorkspaceMediaAsset[] = Array.isArray(media)
      ? media.filter(isMediaSource).map((source) => ({
        id: `${source.path}:${source.name}`,
        name: source.name,
        path: source.path,
        kind: source.kind,
        thumbnailUrl: null,
      }))
      : []
    void window.luna.aiEditor.openWindow(assets)
  }, [active, location.key, location.pathname, location.state])

  return (
    <div className="ai-editor-page" role="status">
      正在打开 AI 剪辑
    </div>
  )
}

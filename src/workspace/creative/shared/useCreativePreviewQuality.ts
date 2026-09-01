import { useCallback, useEffect, useRef, useState } from 'react'

import { useApp } from '../../../context/AppContext'
import type { WorkspacePreviewQuality } from '../../../shared/types/settings'
import { toast } from '../../../ui'
import { normalizeWorkspacePreviewQuality, workspacePreviewMaxSide } from '../../shared/workspacePreviewQuality'

export function useCreativePreviewQuality() {
  const { settings, setSettings } = useApp()
  const [previewQuality, setPreviewQuality] = useState<WorkspacePreviewQuality>(
    () => normalizeWorkspacePreviewQuality(settings?.workspacePreviewQuality),
  )
  const previewQualityRef = useRef(previewQuality)
  const changeRequestRef = useRef(0)
  previewQualityRef.current = previewQuality

  useEffect(() => {
    const nextQuality = normalizeWorkspacePreviewQuality(settings?.workspacePreviewQuality)
    previewQualityRef.current = nextQuality
    setPreviewQuality(nextQuality)
  }, [settings?.workspacePreviewQuality])

  const changePreviewQuality = useCallback((quality: WorkspacePreviewQuality) => {
    if (quality === previewQualityRef.current) return
    const previous = previewQualityRef.current
    const requestId = ++changeRequestRef.current
    previewQualityRef.current = quality
    setPreviewQuality(quality)
    void window.luna.saveSettings({ workspacePreviewQuality: quality })
      .then((saved) => {
        if (requestId === changeRequestRef.current) setSettings(saved)
      })
      .catch(() => {
        if (requestId !== changeRequestRef.current) return
        previewQualityRef.current = previous
        setPreviewQuality(previous)
        toast.error('无法保存预览清晰度')
      })
  }, [setSettings])

  return {
    previewQuality,
    previewMaxSide: workspacePreviewMaxSide(previewQuality),
    changePreviewQuality,
  }
}

import { useEffect, useState } from 'react'

import { deviceProfileForText } from '../shared/insta360DeviceProfiles'

const eligibilityCache = new Map<string, Promise<boolean>>()

export function isLunaUltraExifModel(exifModel?: string | null): boolean {
  return deviceProfileForText(exifModel)?.id === 'luna-ultra'
}

export function canUseLunaUltraWatermark(filePath: string, kind: 'image' | 'video'): Promise<boolean> {
  if (kind === 'video') return Promise.resolve(true)

  const cached = eligibilityCache.get(filePath)
  if (cached) return cached

  const pending = window.luna.readExifModel(filePath)
    .then(isLunaUltraExifModel)
    .catch(() => false)
  eligibilityCache.set(filePath, pending)
  return pending
}

export function useLunaUltraWatermark(
  media?: { path: string; kind: 'image' | 'video' } | null,
): boolean {
  const [resolved, setResolved] = useState<{ path: string; allowed: boolean } | null>(null)
  const mediaPath = media?.path
  const mediaKind = media?.kind

  useEffect(() => {
    if (!mediaPath || !mediaKind) {
      setResolved(null)
      return
    }
    if (mediaKind === 'video') {
      setResolved({ path: mediaPath, allowed: true })
      return
    }

    let cancelled = false
    void canUseLunaUltraWatermark(mediaPath, mediaKind).then((allowed) => {
      if (!cancelled) setResolved({ path: mediaPath, allowed })
    })
    return () => { cancelled = true }
  }, [mediaKind, mediaPath])

  return Boolean(mediaPath && resolved?.path === mediaPath && resolved.allowed)
}

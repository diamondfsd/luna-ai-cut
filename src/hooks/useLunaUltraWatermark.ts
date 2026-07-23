import { useEffect, useState } from 'react'

import { deviceProfileForText } from '../shared/insta360DeviceProfiles'

const eligibilityCache = new Map<string, Promise<boolean>>()

export function isLunaUltraExifModel(exifModel?: string | null): boolean {
  return deviceProfileForText(exifModel)?.id === 'luna-ultra'
}

export function canUseLunaUltraWatermark(filePath: string, kind?: 'image' | 'video'): Promise<boolean> {
  const cacheKey = `${kind ?? 'media'}:${filePath}`
  const cached = eligibilityCache.get(cacheKey)
  if (cached) return cached

  const pending = window.luna.readExifModel(filePath)
    .then(isLunaUltraExifModel)
    .catch(() => false)
  eligibilityCache.set(cacheKey, pending)
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
    let cancelled = false
    void canUseLunaUltraWatermark(mediaPath, mediaKind).then((allowed) => {
      if (!cancelled) setResolved({ path: mediaPath, allowed })
    })
    return () => { cancelled = true }
  }, [mediaKind, mediaPath])

  return Boolean(mediaPath && resolved?.path === mediaPath && resolved.allowed)
}

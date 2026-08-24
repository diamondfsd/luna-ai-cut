import { useEffect, useState } from 'react'

import { inferDeviceProfile } from '../shared/insta360DeviceProfiles'
import type { DeviceMetadataLike } from '../shared/insta360DeviceProfiles'

const eligibilityCache = new Map<string, Promise<boolean>>()

export function isSupportedDeviceExifModel(exifModel?: string | null): boolean {
  return Boolean(inferDeviceProfile({ exifModel }))
}

export function canUseDeviceWatermark(
  filePath: string,
  kind?: 'image' | 'video',
  metadata?: DeviceMetadataLike | null,
): Promise<boolean> {
  if (inferDeviceProfile(metadata ?? {})) return Promise.resolve(true)

  const cacheKey = `${kind ?? 'media'}:${filePath}`
  const cached = eligibilityCache.get(cacheKey)
  if (cached) return cached

  const pending = window.luna.readExifModel(filePath)
    .then(isSupportedDeviceExifModel)
    .catch(() => false)
  eligibilityCache.set(cacheKey, pending)
  return pending
}

export function useDeviceWatermark(
  media?: (DeviceMetadataLike & { path: string; kind: 'image' | 'video' }) | null,
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
    void canUseDeviceWatermark(mediaPath, mediaKind, media).then((allowed) => {
      if (!cancelled) setResolved({ path: mediaPath, allowed })
    })
    return () => { cancelled = true }
  }, [media, mediaKind, mediaPath])

  return Boolean(mediaPath && resolved?.path === mediaPath && resolved.allowed)
}

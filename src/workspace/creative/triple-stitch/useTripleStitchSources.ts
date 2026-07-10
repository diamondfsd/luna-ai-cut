import { useEffect, useMemo, useState } from 'react'

import type { WorkspaceMediaAsset } from '../../../shared/types'
import { toast } from '../../../ui'
import { normalizeCreativePipeline, type CreativeSlotSource } from '../shared/creativeMedia'

export interface TripleStitchSource extends CreativeSlotSource {
  filePath: string
  isVideo: boolean
  sourceReady: boolean
}

export function useTripleStitchSources(
  media: WorkspaceMediaAsset[],
  selectedIds: string[],
): TripleStitchSource[] {
  const baseSources = useMemo(() => selectedIds
    .map((id) => media.find((asset) => asset.id === id))
    .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset))
    .map((asset) => ({
      asset,
      pipeline: normalizeCreativePipeline((asset as { pipeline?: unknown }).pipeline),
    })), [media, selectedIds])
  const [liveVideoPaths, setLiveVideoPaths] = useState<Record<string, string>>({})
  const [detectedLivePhotos, setDetectedLivePhotos] = useState<Record<string, boolean>>({})
  const [failedLivePhotos, setFailedLivePhotos] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    const unchecked = baseSources.filter(({ asset }) => (
      asset.kind === 'image' && asset.isLivePhoto === undefined && detectedLivePhotos[asset.id] === undefined
    ))
    if (unchecked.length === 0) return

    void Promise.all(unchecked.map(async ({ asset }) => {
      const isLivePhoto = await window.luna.workspace.isLivePhoto(asset.path).catch(() => false)
      return [asset.id, isLivePhoto] as const
    })).then((entries) => {
      if (cancelled) return
      setDetectedLivePhotos((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })

    return () => { cancelled = true }
  }, [baseSources, detectedLivePhotos])

  useEffect(() => {
    let cancelled = false
    const unresolved = baseSources.filter(({ asset }) => {
      const isLivePhoto = asset.isLivePhoto === true || detectedLivePhotos[asset.id] === true
      return isLivePhoto && !liveVideoPaths[asset.id] && !failedLivePhotos[asset.id]
    })
    if (unresolved.length === 0) return

    void Promise.all(unresolved.map(async ({ asset }) => {
      try {
        const result = await window.luna.previewLivePhoto(asset.path)
        if (!result.cachedPath) throw new Error('没有找到可播放片段')
        return [asset.id, result.cachedPath] as const
      } catch (error) {
        toast.error(`无法读取「${asset.name}」的视频部分`)
        console.error('[TripleStitchCreative] Live Photo video unavailable', error)
        return asset.id
      }
    })).then((entries) => {
      if (cancelled) return
      const available = entries.filter((entry): entry is readonly [string, string] => Array.isArray(entry))
      const failed = entries.filter((entry): entry is string => typeof entry === 'string')
      if (available.length > 0) {
        setLiveVideoPaths((current) => ({ ...current, ...Object.fromEntries(available) }))
      }
      if (failed.length > 0) {
        setFailedLivePhotos((current) => ({
          ...current,
          ...Object.fromEntries(failed.map((id) => [id, true])),
        }))
      }
    })

    return () => { cancelled = true }
  }, [baseSources, detectedLivePhotos, failedLivePhotos, liveVideoPaths])

  const resolvedSources = useMemo(() => baseSources.map(({ asset, pipeline }) => {
    const liveStatus = asset.kind === 'video'
      ? false
      : asset.isLivePhoto ?? detectedLivePhotos[asset.id]
    const liveVideoPath = liveStatus ? liveVideoPaths[asset.id] : undefined
    const filePath = liveVideoPath ?? asset.path
    return {
      asset,
      pipeline,
      filePath,
      isVideo: asset.kind === 'video' || Boolean(liveVideoPath),
      sourceReady: asset.kind === 'video' || liveStatus === false || Boolean(liveVideoPath),
    }
  }), [baseSources, detectedLivePhotos, liveVideoPaths])

  return resolvedSources
}

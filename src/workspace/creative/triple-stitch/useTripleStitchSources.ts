import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceMediaAsset } from '../../../shared/types'
import { toast } from '../../../ui'
import { normalizeCreativePipeline, type CreativeSlotSource } from '../shared/creativeMedia'
import { filePathToPreviewUrl } from '../../../lib/fileUtils'

export interface TripleStitchSource extends CreativeSlotSource {
  filePath: string
  isVideo: boolean
  sourceReady: boolean
  /** 素材真实时长（秒），用于起始时间滑块的 max 计算 */
  duration?: number
}

/** 通过临时 video 元素获取视频文件时长 */
function fetchVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const src = filePathToPreviewUrl(filePath) ?? filePath
    const cleanup = () => { video.src = ''; video.load() }
    video.onloadedmetadata = () => {
      const d = video.duration
      cleanup()
      if (Number.isFinite(d) && d > 0) resolve(d)
      else reject(new Error(`Invalid duration: ${d}`))
    }
    video.onerror = () => { cleanup(); reject(new Error('Failed to load video metadata')) }
    video.src = src
  })
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
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({})
  const [detectedLivePhotos, setDetectedLivePhotos] = useState<Record<string, boolean>>({})
  const [failedLivePhotos, setFailedLivePhotos] = useState<Record<string, boolean>>({})

  // Step 1: 检测 Live Photo
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

  // Step 2: 解析 Live Photo 视频路径
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
        setLiveVideoPaths((current) => ({ ...current, ...Object.fromEntries(available.map(([id, path]) => [id, path])) }))
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

  // Step 3: 获取所有视频文件的时长（普通视频 + live photo 视频）
  useEffect(() => {
    let cancelled = false
    const pending = baseSources
      .map(({ asset }) => {
        const liveStatus = asset.kind === 'video'
          ? false
          : asset.isLivePhoto ?? detectedLivePhotos[asset.id]
        const liveVideoPath = liveStatus ? liveVideoPaths[asset.id] : undefined
        const filePath = liveVideoPath ?? asset.path
        const isVideo = asset.kind === 'video' || Boolean(liveVideoPath)
        return { filePath, isVideo }
      })
      .filter(({ filePath, isVideo }) =>
        isVideo && filePath && !videoDurations[filePath],
      )

    if (pending.length === 0) return

    void Promise.all(pending.map(async ({ filePath }) => {
      try {
        const duration = await fetchVideoDuration(filePath)
        return [filePath, duration] as const
      } catch {
        return null
      }
    })).then((results) => {
      if (cancelled) return
      const valid = results.filter((r): r is readonly [string, number] => r !== null)
      if (valid.length > 0) {
        setVideoDurations((current) => ({ ...current, ...Object.fromEntries(valid) }))
      }
    })

    return () => { cancelled = true }
  }, [baseSources, detectedLivePhotos, liveVideoPaths, videoDurations])

  const prevResolvedRef = useRef<TripleStitchSource[] | null>(null)

  const resolvedSources = useMemo(() => {
    const result = baseSources.map(({ asset, pipeline }) => {
      const liveStatus = asset.kind === 'video'
        ? false
        : asset.isLivePhoto ?? detectedLivePhotos[asset.id]
      const liveVideoPath = liveStatus ? liveVideoPaths[asset.id] : undefined
      const filePath = liveVideoPath ?? asset.path
      const isVideo = asset.kind === 'video' || Boolean(liveVideoPath)
      return {
        asset,
        pipeline,
        filePath,
        isVideo,
        sourceReady: asset.kind === 'video' || liveStatus === false || Boolean(liveVideoPath),
        duration: isVideo ? videoDurations[filePath] : undefined,
      }
    })

    // 诊断日志：追踪 isVideo / filePath 变化
    if (prevResolvedRef.current) {
      const prev = prevResolvedRef.current
      for (let i = 0; i < Math.max(prev.length, result.length); i++) {
        const prevItem = prev[i]
        const curItem = result[i]
        if (!prevItem || !curItem) continue
        if (prevItem.isVideo !== curItem.isVideo || prevItem.filePath !== curItem.filePath) {
          console.warn(
            `[LivePhoto-Diag] slot[${i}] 变化:`,
            `isVideo: ${prevItem.isVideo} → ${curItem.isVideo}`,
            `filePath: ${prevItem.filePath?.slice(-40)} → ${curItem.filePath?.slice(-40)}`,
            `asset.isLivePhoto: ${curItem.asset.isLivePhoto}`,
            `detected: ${detectedLivePhotos[curItem.asset.id]}`,
            `liveVideoPath: ${liveVideoPaths[curItem.asset.id]}`,
          )
        }
      }
    }
    prevResolvedRef.current = result

    return result
  }, [baseSources, detectedLivePhotos, liveVideoPaths, videoDurations])

  return resolvedSources
}

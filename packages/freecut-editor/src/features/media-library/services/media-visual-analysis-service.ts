import type { MediaMetadata } from '@freecut/types/storage'
import {
  captionImage,
  captionVideo,
  type MediaCaption,
} from '../deps/analysis'
import { importMediaLibraryService } from './media-library-service-loader'
import { getMediaType } from '../utils/validation'

export type VisualAnalysisIntensity = 'light' | 'normal' | 'strong'

interface VisualAnalysisProfile {
  maxSamples: number
}

const VISUAL_ANALYSIS_PROFILES: Record<VisualAnalysisIntensity, VisualAnalysisProfile> = {
  light: { maxSamples: 2 },
  normal: { maxSamples: 4 },
  strong: { maxSamples: 12 },
}

function sampleTimes(durationSeconds: number, maxSamples: number): number[] {
  const duration = Math.max(0.1, durationSeconds)
  const count = Math.min(maxSamples, Math.max(1, Math.ceil(duration / 4)))
  const edge = Math.min(0.25, duration / 4)
  if (count === 1) return [Number(Math.min(edge, duration / 2).toFixed(3))]
  return Array.from({ length: count }, (_, index) => Number((
    edge + index * (duration - edge * 2) / (count - 1)
  ).toFixed(3)))
}

async function captionsForMedia(
  media: MediaMetadata,
  intensity: VisualAnalysisIntensity,
  signal?: AbortSignal,
): Promise<MediaCaption[]> {
  const { mediaLibraryService } = await importMediaLibraryService()
  const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id)
  if (!blobUrl) throw new Error('无法读取这段素材的画面。')

  const mediaType = getMediaType(media.mimeType)
  let video: HTMLVideoElement | undefined
  try {
    if (mediaType === 'image') {
      const response = await fetch(blobUrl, { signal })
      signal?.throwIfAborted()
      return await captionImage(await response.blob(), { signal })
    }

    const currentVideo = document.createElement('video')
    video = currentVideo
    currentVideo.muted = true
    currentVideo.preload = 'auto'
    currentVideo.src = blobUrl
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        cleanup()
        reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      }
      currentVideo.onloadedmetadata = () => {
        cleanup()
        resolve()
      }
      currentVideo.onerror = () => {
        cleanup()
        reject(new Error('无法读取视频画面。'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    signal?.throwIfAborted()
    return await captionVideo(currentVideo, {
      signal,
      sampleTimesSec: sampleTimes(media.duration, VISUAL_ANALYSIS_PROFILES[intensity].maxSamples),
    })
  } finally {
    if (video) {
      // Clearing the source releases the decoder. The host owns native URLs,
      // while object URLs created by the media service must also be revoked.
      video.src = ''
    }
    if (!media.nativePath) {
      URL.revokeObjectURL(blobUrl)
    }
  }
}

export async function analyzeMediaVisual(
  media: MediaMetadata,
  intensity: VisualAnalysisIntensity = 'light',
  signal?: AbortSignal,
): Promise<{ captions: MediaCaption[]; intensity: VisualAnalysisIntensity }> {
  const captions = await captionsForMedia(media, intensity, signal)
  signal?.throwIfAborted()

  const { mediaLibraryService } = await importMediaLibraryService()
  await mediaLibraryService.updateMediaCaptions(media.id, captions, {
    service: 'lfm-captioning',
    model: 'lfm-2.5-vl',
  })

  return { captions, intensity }
}

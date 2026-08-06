/**
 * Adapter exports for media-library dependencies.
 * Export modules should import media resolution helpers from here.
 */

import { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import type { MediaMetadata } from '@freecut/types/storage'

export {
  resolveMediaUrl,
  resolveMediaUrls,
  resolveProxyUrl,
} from '@freecut/features/media-library/utils/media-resolver'

export function getMediaAudioCodecById(mediaId: string | undefined): string | undefined {
  if (!mediaId) return undefined

  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) return undefined

  if (media.mimeType.startsWith('video/')) {
    return media.audioCodec
  }
  if (media.mimeType.startsWith('audio/')) {
    return media.codec
  }
  return undefined
}

export function getMediaMetadataById(mediaId: string | undefined): MediaMetadata | undefined {
  if (!mediaId) return undefined
  return useMediaLibraryStore.getState().mediaById[mediaId]
}

export function useMediaMetadataById(mediaId: string | undefined): MediaMetadata | undefined {
  return useMediaLibraryStore((state) => (mediaId ? state.mediaById[mediaId] : undefined))
}

export async function getMediaFileById(mediaId: string): Promise<Blob | null> {
  const { mediaLibraryService } = await importMediaLibraryService()
  return mediaLibraryService.getMediaFile(mediaId)
}

export function useBrokenMediaIds(): string[] {
  return useMediaLibraryStore((state) => state.brokenMediaIds)
}

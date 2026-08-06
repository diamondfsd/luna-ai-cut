import { useProjectMediaMatchDialogStore } from '@freecut/shared/state/project-media-match-dialog'
import { useMediaLibraryStore } from '@freecut/features/timeline/deps/media-library-store'
import {
  getMimeType,
  mediaProcessorService,
  type ExtractedMediaFileEntry,
} from '@freecut/features/timeline/deps/media-library-resolver'

export async function preflightFirstTimelineVisualProjectMatch(
  entries: ExtractedMediaFileEntry[],
): Promise<void> {
  const currentProjectId = useMediaLibraryStore.getState().currentProjectId
  if (!currentProjectId) {
    return
  }

  const hasExistingProjectVisual = useMediaLibraryStore
    .getState()
    .mediaItems.some(
      (item) => item.mimeType.startsWith('video/') || item.mimeType.startsWith('image/'),
    )
  if (hasExistingProjectVisual) {
    return
  }

  const firstVisualEntry = entries.find(
    (entry) => entry.mediaType === 'video' || entry.mediaType === 'image',
  )
  if (!firstVisualEntry) {
    return
  }

  const mimeType = getMimeType(firstVisualEntry.file)
  const { metadata } = await mediaProcessorService.processMedia(firstVisualEntry.file, mimeType, {
    generateThumbnail: false,
    fastMetadata: true,
  })

  if (metadata.type !== 'video' && metadata.type !== 'image') {
    throw new Error('Unable to inspect dropped visual media.')
  }

  await useProjectMediaMatchDialogStore.getState().requestProjectMediaMatch(currentProjectId, {
    fileName: firstVisualEntry.file.name,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.type === 'video' ? metadata.fps : undefined,
  })
}

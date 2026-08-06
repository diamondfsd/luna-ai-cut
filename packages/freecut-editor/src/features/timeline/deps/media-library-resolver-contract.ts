export { mediaProcessorService } from '@freecut/features/media-library/services/media-processor-service'
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
} from '@freecut/features/media-library/utils/media-resolver'
export {
  getMediaDragData,
  clearMediaDragData,
  type CompositionDragData,
} from '@freecut/features/media-library/utils/drag-data-cache'
export {
  extractValidMediaFileEntriesFromDataTransfer,
  formatMediaDropRejectionMessage,
} from '@freecut/features/media-library/utils/file-drop'
export type { OrphanedClipInfo } from '@freecut/features/media-library/types'
export type { ExtractedMediaFileEntry } from '@freecut/features/media-library/utils/file-drop'
export { getMediaType, getMimeType } from '@freecut/features/media-library/utils/validation'

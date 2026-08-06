/**
 * Adapter exports for media-library dependencies.
 * Preview modules should import media-library stores/services/utils from here.
 */

export { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
export { proxyService } from '@freecut/features/media-library/services/proxy-service'
export { mediaProcessorService } from '@freecut/features/media-library/services/media-processor-service'
export { getMediaType, getMimeType } from '@freecut/features/media-library/utils/validation'
export { getProjectBrokenMediaIds } from '@freecut/features/media-library/utils/broken-media'
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
  cleanupBlobUrls,
} from '@freecut/features/media-library/utils/media-resolver'
export { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
export { FileAccessError } from '@freecut/features/media-library/services/file-access'
export { extractValidMediaFileEntriesFromDataTransfer } from '@freecut/features/media-library/utils/file-drop'
export {
  getMediaDragData,
  clearMediaDragData,
} from '@freecut/features/media-library/utils/drag-data-cache'

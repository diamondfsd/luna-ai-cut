/**
 * Adapter exports for media-library dependencies.
 * Editor modules should import media-library stores/components/utils/services from here.
 */

export { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
export { useEmbeddedSubtitlePickerStore } from '@freecut/features/media-library/stores/embedded-subtitle-picker-store'
export { useSubtitleScanProgressStore } from '@freecut/features/media-library/stores/subtitle-scan-progress-store'
export { getSharedProxyKey } from '@freecut/features/media-library/utils/proxy-key'
export { resolveMediaUrl } from '@freecut/features/media-library/utils/media-resolver'
export {
  clearMediaDragData,
  getMediaDragData,
  setMediaDragData,
} from '@freecut/features/media-library/utils/drag-data-cache'
export { MediaLibrary } from '@freecut/features/media-library/components/media-library'

export const importProxyService = () => import('@freecut/features/media-library/services/proxy-service')
export const importMediaLibraryService = () =>
  import('@freecut/features/media-library/services/media-library-service')
export const importThumbnailGenerator = () =>
  import('@freecut/features/media-library/utils/thumbnail-generator')
export const importEmbeddedSubtitleTrackPickerHost = () =>
  import('@freecut/features/media-library/components/embedded-subtitle-track-picker-host')
export const importSubtitleScanProgressDialog = () =>
  import('@freecut/features/media-library/components/subtitle-scan-progress-dialog')

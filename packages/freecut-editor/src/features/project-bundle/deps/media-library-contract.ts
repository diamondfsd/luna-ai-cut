/**
 * Adapter exports for media-library dependencies.
 * Project-bundle modules should import media services/utilities from here.
 */

export { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
export { generateThumbnail } from '@freecut/features/media-library/utils/thumbnail-generator'
export { computeContentHashFromBuffer } from '@freecut/features/media-library/utils/content-hash'

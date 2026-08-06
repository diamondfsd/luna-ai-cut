/**
 * Adapter exports for timeline cache-service dependencies.
 * Editor modules should import lazy cache helpers from here.
 */

export const importGifFrameCache = () => import('@freecut/features/timeline/services/gif-frame-cache')
export const importFilmstripCache = () => import('@freecut/features/timeline/services/filmstrip-cache')
export const importWaveformCache = () => import('@freecut/features/timeline/services/waveform-cache')

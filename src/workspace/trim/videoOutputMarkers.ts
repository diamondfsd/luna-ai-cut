export const DEFAULT_LIVE_PHOTO_DURATION = 3
export const MIN_LIVE_PHOTO_DURATION = 0.1
export const MAX_LIVE_PHOTO_DURATION = 5
/** @deprecated Use DEFAULT_LIVE_PHOTO_DURATION for new code. */
export const LIVE_PHOTO_DURATION = DEFAULT_LIVE_PHOTO_DURATION
const MIN_VIDEO_SEGMENT_DURATION = 0.1
const MAX_NOTE_LENGTH = 200

interface VideoOutputMarkerBase {
  id: string
  note: string
}

export interface VideoSegmentOutputMarker extends VideoOutputMarkerBase {
  kind: 'video'
  startTime: number
  endTime: number
}

export interface LivePhotoOutputMarker extends VideoOutputMarkerBase {
  kind: 'live'
  startTime: number
  endTime: number
  coverTime: number
}

export interface PhotoOutputMarker extends VideoOutputMarkerBase {
  kind: 'photo'
  time: number
}

export type VideoOutputMarker = VideoSegmentOutputMarker | LivePhotoOutputMarker | PhotoOutputMarker

export function livePhotoSelectionForMarker(
  markers: VideoOutputMarker[],
  markerId: string | null,
): { markerId: string; startTime: number; endTime: number; coverTime: number } | null {
  if (!markerId) return null
  const marker = markers.find((candidate): candidate is LivePhotoOutputMarker => (
    candidate.kind === 'live' && candidate.id === markerId
  ))
  return marker
    ? {
        markerId: marker.id,
        startTime: marker.startTime,
        endTime: marker.endTime,
        coverTime: marker.coverTime,
      }
    : null
}

export interface VideoOutputExportItem {
  markerId: string
  kind: VideoOutputMarker['kind']
  outputBaseName: string
  startTime?: number
  endTime?: number
  time?: number
  coverTime?: number
}

function safeOutputNamePart(value: string, fallback: string, maxLength = 60): string {
  const normalized = Array.from(value, (character) => (
    character.charCodeAt(0) < 32 ? '-' : character
  )).join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return Array.from(normalized || fallback).slice(0, maxLength).join('')
}

function normalizeId(value: unknown, index: number, usedIds: Set<string>): string {
  const baseId = typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : `output-${index + 1}`
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function normalizeNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_NOTE_LENGTH) : ''
}

export function clampLivePhotoDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIVE_PHOTO_DURATION
  return Math.min(MAX_LIVE_PHOTO_DURATION, Math.max(MIN_LIVE_PHOTO_DURATION, value))
}

export function livePhotoRangeAround(
  time: number,
  duration: number,
  liveDuration = DEFAULT_LIVE_PHOTO_DURATION,
): { startTime: number; endTime: number; coverTime: number } | null {
  const safeLiveDuration = clampLivePhotoDuration(liveDuration)
  if (!Number.isFinite(duration) || duration < safeLiveDuration) return null
  const safeTime = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration))
  const startTime = Math.max(0, Math.min(safeTime - safeLiveDuration / 2, duration - safeLiveDuration))
  return {
    startTime,
    endTime: startTime + safeLiveDuration,
    coverTime: Math.min(safeTime, startTime + safeLiveDuration - 0.01),
  }
}

export function resizeLivePhotoRange(
  startTime: number,
  endTime: number,
  coverTime: number,
  requestedDuration: number,
  sourceDuration: number,
): { startTime: number; endTime: number; coverTime: number } | null {
  if (![startTime, endTime, coverTime, requestedDuration, sourceDuration].every(Number.isFinite)) return null
  const maximumDuration = Math.min(MAX_LIVE_PHOTO_DURATION, Math.floor(sourceDuration * 10) / 10)
  if (maximumDuration < MIN_LIVE_PHOTO_DURATION) return null

  const clampedDuration = Math.min(maximumDuration, Math.max(MIN_LIVE_PHOTO_DURATION, requestedDuration))
  const nextDuration = Math.min(maximumDuration, Math.round(clampedDuration * 10) / 10)
  const center = (startTime + endTime) / 2
  const nextStart = Math.max(0, Math.min(center - nextDuration / 2, sourceDuration - nextDuration))
  const nextEnd = nextStart + nextDuration

  return {
    startTime: nextStart,
    endTime: nextEnd,
    coverTime: Math.max(nextStart, Math.min(coverTime, nextEnd - 0.01)),
  }
}

export function normalizeVideoOutputMarkers(value: unknown, sourceDuration?: number): VideoOutputMarker[] {
  if (!Array.isArray(value)) return []
  const maximumTime = Number.isFinite(sourceDuration) && Number(sourceDuration) >= 0
    ? Number(sourceDuration)
    : Number.POSITIVE_INFINITY
  const usedIds = new Set<string>()

  return value.map((item, index): VideoOutputMarker | null => {
    if (!item || typeof item !== 'object') return null
    const marker = item as Partial<VideoOutputMarker> & Record<string, unknown>
    if (marker.kind === 'photo') {
      if (!Number.isFinite(marker.time)) return null
      const time = Number(marker.time)
      if (time < 0 || time > maximumTime || (maximumTime > 0 && time >= maximumTime)) return null
      return {
        id: normalizeId(marker.id, index, usedIds),
        kind: 'photo',
        time,
        note: normalizeNote(marker.note),
      }
    }

    if (marker.kind !== 'video' && marker.kind !== 'live') return null
    if (!Number.isFinite(marker.startTime) || !Number.isFinite(marker.endTime)) return null
    const startTime = Number(marker.startTime)
    const endTime = Number(marker.endTime)
    if (startTime < 0 || endTime > maximumTime) return null

    if (marker.kind === 'live') {
      const liveDuration = endTime - startTime
      if (liveDuration < MIN_LIVE_PHOTO_DURATION || liveDuration > MAX_LIVE_PHOTO_DURATION) return null
      const coverTime = Number(marker.coverTime)
      if (!Number.isFinite(coverTime) || coverTime < startTime || coverTime >= endTime) return null
      return {
        id: normalizeId(marker.id, index, usedIds),
        kind: 'live',
        startTime,
        endTime,
        coverTime,
        note: normalizeNote(marker.note),
      }
    }

    if (endTime < startTime + MIN_VIDEO_SEGMENT_DURATION) return null
    return {
      id: normalizeId(marker.id, index, usedIds),
      kind: 'video',
      startTime,
      endTime,
      note: normalizeNote(marker.note),
    }
  }).filter((marker): marker is VideoOutputMarker => marker !== null)
    .sort((a, b) => {
      const aTime = a.kind === 'photo' ? a.time : a.startTime
      const bTime = b.kind === 'photo' ? b.time : b.startTime
      return aTime - bTime || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    })
}

export function buildVideoOutputExportItems(
  sourceBaseName: string,
  markers: VideoOutputMarker[],
  sourceDuration: number,
): VideoOutputExportItem[] {
  const baseName = safeOutputNamePart(sourceBaseName, 'video', 120)
  const normalized = normalizeVideoOutputMarkers(markers, sourceDuration)
  const sequenceByKind = { video: 0, photo: 0, live: 0 }

  return normalized.map((marker) => {
    sequenceByKind[marker.kind] += 1
    const sequence = String(sequenceByKind[marker.kind]).padStart(2, '0')
    const note = safeOutputNamePart(marker.note, '', 60)
    const suffix = note ? `_${note}` : ''
    if (marker.kind === 'photo') {
      return {
        markerId: marker.id,
        kind: marker.kind,
        time: marker.time,
        outputBaseName: `${baseName}_照片-${sequence}${suffix}`,
      }
    }
    if (marker.kind === 'live') {
      return {
        markerId: marker.id,
        kind: marker.kind,
        startTime: marker.startTime,
        endTime: marker.endTime,
        coverTime: marker.coverTime,
        outputBaseName: `${baseName}_Live-${sequence}${suffix}`,
      }
    }
    return {
      markerId: marker.id,
      kind: marker.kind,
      startTime: marker.startTime,
      endTime: marker.endTime,
      outputBaseName: `${baseName}_片段-${sequence}${suffix}`,
    }
  })
}

import type { WorkspaceVideoSegmentsExport } from '../../shared/types'

export interface VideoSegmentMarker {
  id: string
  startTime: number
  endTime: number
  note: string
}

export interface VideoSegmentExportRange {
  startTime: number
  endTime: number
  outputBaseName: string
}

const MIN_SEGMENT_DURATION = 0.1
const MAX_NOTE_LENGTH = 200

export function normalizeVideoSegmentMarkers(value: unknown): VideoSegmentMarker[] {
  if (!Array.isArray(value)) return []

  const usedIds = new Set<string>()
  return value
    .map((item, index): VideoSegmentMarker | null => {
      if (!item || typeof item !== 'object') return null
      const marker = item as Partial<VideoSegmentMarker>
      if (!Number.isFinite(marker.startTime) || !Number.isFinite(marker.endTime)) return null

      const startTime = Math.max(0, Number(marker.startTime))
      const endTime = Number(marker.endTime)
      if (endTime < startTime + MIN_SEGMENT_DURATION) return null

      const baseId = typeof marker.id === 'string' && marker.id.trim()
        ? marker.id.trim().slice(0, 80)
        : `segment-${index + 1}`
      let id = baseId
      let suffix = 2
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`
        suffix += 1
      }
      usedIds.add(id)

      return {
        id,
        startTime,
        endTime,
        note: typeof marker.note === 'string' ? marker.note.trim().slice(0, MAX_NOTE_LENGTH) : '',
      }
    })
    .filter((marker): marker is VideoSegmentMarker => marker !== null)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
}

export function buildVideoSegmentsExport(sourcePath: string, markers: VideoSegmentMarker[]): WorkspaceVideoSegmentsExport {
  return {
    sourcePath,
    segments: normalizeVideoSegmentMarkers(markers).map(({ note, startTime, endTime }) => ({
      note,
      startTime,
      endTime,
    })),
  }
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

export function buildVideoSegmentExportRanges(
  sourceBaseName: string,
  markers: VideoSegmentMarker[],
  sourceDuration?: number,
): VideoSegmentExportRange[] {
  const baseName = safeOutputNamePart(sourceBaseName, 'video', 120)
  const maximumEnd = Number.isFinite(sourceDuration) && Number(sourceDuration) > 0
    ? Number(sourceDuration)
    : Number.POSITIVE_INFINITY

  return normalizeVideoSegmentMarkers(markers)
    .map((marker) => ({
      ...marker,
      startTime: Math.min(marker.startTime, maximumEnd),
      endTime: Math.min(marker.endTime, maximumEnd),
    }))
    .filter((marker) => marker.endTime >= marker.startTime + MIN_SEGMENT_DURATION)
    .map((marker, index) => {
      const sequence = String(index + 1).padStart(2, '0')
      const note = safeOutputNamePart(marker.note, '', 60)
      return {
        startTime: marker.startTime,
        endTime: marker.endTime,
        outputBaseName: `${baseName}_片段-${sequence}${note ? `_${note}` : ''}`,
      }
    })
}

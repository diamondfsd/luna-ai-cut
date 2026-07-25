import type { WorkspaceVideoSegmentsExport } from '../../shared/types'

export interface VideoSegmentMarker {
  id: string
  startTime: number
  endTime: number
  note: string
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

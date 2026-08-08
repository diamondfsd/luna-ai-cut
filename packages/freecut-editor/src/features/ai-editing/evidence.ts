import { getEditingEvidence, getTranscript } from '@freecut/infrastructure/storage'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useSelectionStore } from '@freecut/shared/state/selection'
import type { MediaMetadata, MediaTranscript } from '@freecut/types/storage'
import type { TimelineItem } from '@freecut/types/timeline'
import { getAudioBeatEvidence } from './audio-beat-service'
import type { AiMediaEvidence, AiProjectEvidence, AiTimelineClipEvidence } from './types'

const MAX_VISUAL_OBSERVATIONS = 24
const MAX_TRANSCRIPT_MATCHES = 40

function mediaKind(media: MediaMetadata): AiMediaEvidence['kind'] {
  if (media.mimeType.startsWith('video/')) return 'video'
  if (media.mimeType.startsWith('audio/')) return 'audio'
  if (media.mimeType.startsWith('image/')) return 'image'
  return 'other'
}

function sourceFingerprint(media: MediaMetadata): string {
  return media.contentHash ?? `${media.fileSize}:${media.fileLastModified ?? media.updatedAt}`
}

function countWords(transcript: MediaTranscript): number {
  return transcript.segments.reduce((count, segment) => count + (segment.words?.length ?? 0), 0)
}

function cropEvidence(item: TimelineItem): AiTimelineClipEvidence['crop'] {
  if (!item.crop) return undefined
  return {
    left: item.crop.left ?? 0,
    right: item.crop.right ?? 0,
    top: item.crop.top ?? 0,
    bottom: item.crop.bottom ?? 0,
  }
}

function textEvidence(item: TimelineItem): string | undefined {
  if (item.type === 'text') return item.text.slice(0, 500)
  if (item.type === 'subtitle') return `${item.cues.length} 条字幕`
  return undefined
}

function buildTimelineEvidence(): { clips: AiTimelineClipEvidence[]; durationSeconds: number; fps: number; revision: number } {
  const timeline = useTimelineStore.getState()
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const selectedIds = new Set(useSelectionStore.getState().selectedItemIds)
  const clips = timeline.items.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.type,
    trackId: item.trackId,
    startSeconds: item.from / fps,
    endSeconds: (item.from + item.durationInFrames) / fps,
    ...(item.type === 'video' || item.type === 'audio' ? { mediaId: item.mediaId } : {}),
    selected: selectedIds.has(item.id),
    ...(item.linkedGroupId ? { linkedGroupId: item.linkedGroupId } : {}),
    ...(item.sourceStart !== undefined
      ? { sourceStartSeconds: item.sourceStart / (item.sourceFps || fps) }
      : {}),
    ...(item.sourceEnd !== undefined
      ? { sourceEndSeconds: item.sourceEnd / (item.sourceFps || fps) }
      : {}),
    speed: item.speed ?? 1,
    reversed: item.isReversed ?? false,
    ...(item.volume !== undefined ? { volumeDb: item.volume } : {}),
    ...(textEvidence(item) ? { text: textEvidence(item) } : {}),
    ...(cropEvidence(item) ? { crop: cropEvidence(item) } : {}),
    ...(item.transform ? { transform: item.transform } : {}),
    effectCount: item.effects?.length ?? 0,
    hasMotion: Boolean(item.motionLayers?.length || item.motionModifiers?.length),
  }))
  const durationSeconds = clips.reduce((duration, clip) => Math.max(duration, clip.endSeconds), 0)
  return { clips, durationSeconds, fps, revision: timeline.changeVersion ?? 0 }
}

function evidenceTrackKind(track: { name: string; kind?: string }): 'video' | 'audio' | 'other' {
  if (track.kind === 'video' || /^V\d+$/i.test(track.name)) return 'video'
  if (track.kind === 'audio' || /^A\d+$/i.test(track.name)) return 'audio'
  return 'other'
}

export function getTimelineRevision(): number {
  return useTimelineStore.getState().changeVersion ?? 0
}

export async function buildProjectEvidence(): Promise<AiProjectEvidence> {
  const timeline = buildTimelineEvidence()
  const playback = usePlaybackStore.getState()
  const selection = useSelectionStore.getState()
  const mediaItems = useMediaLibraryStore.getState().mediaItems
  const media = await Promise.all(mediaItems.map(buildMediaEvidence))
  return {
    timelineRevision: timeline.revision,
    fps: timeline.fps,
    durationSeconds: timeline.durationSeconds,
    playheadSeconds: playback.currentFrame / timeline.fps,
    selection: {
      itemIds: [...selection.selectedItemIds],
      trackIds: [...selection.selectedTrackIds],
      activeTrackId: selection.activeTrackId,
      type: selection.selectionType,
    },
    clips: timeline.clips,
    tracks: useTimelineStore.getState().tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: evidenceTrackKind(track),
      order: track.order,
      locked: track.locked,
      syncLock: track.syncLock !== false,
      visible: track.visible,
      muted: track.muted,
      solo: track.solo,
      volumeDb: track.volume ?? 0,
    })),
    media,
  }
}

export async function buildProjectSnapshot(): Promise<unknown> {
  const evidence = await buildProjectEvidence()
  return {
    ...evidence,
    media: evidence.media.map((media) => ({
      mediaId: media.mediaId,
      name: media.name,
      kind: media.kind,
      durationSeconds: media.durationSeconds,
      visualEvidenceCount: media.visual.length,
      transcript: media.transcript,
      audio: media.audio,
    })),
  }
}

async function buildMediaEvidence(media: MediaMetadata): Promise<AiMediaEvidence> {
  const [transcript, editingEvidence] = await Promise.all([
    getTranscript(media.id).catch(() => undefined),
    getEditingEvidence(media.id).catch(() => undefined),
  ])
  const captions = media.aiCaptions ?? []
  const beats = getAudioBeatEvidence(media.id)
  const matchingVisualEvidence = editingEvidence?.sourceFingerprint === sourceFingerprint(media)
    ? editingEvidence.visual?.samples ?? []
    : []
  return {
    mediaId: media.id,
    name: media.fileName,
    kind: mediaKind(media),
    durationSeconds: media.duration,
    sourceFingerprint: sourceFingerprint(media),
    visual: [
      ...captions.slice(0, MAX_VISUAL_OBSERVATIONS).map((caption) => ({
        timeSeconds: caption.timeSec,
        description: caption.text,
        subjects: caption.sceneData?.subjects ?? [],
        ...(caption.sceneData?.action ? { action: caption.sceneData.action } : {}),
      })),
      ...matchingVisualEvidence.slice(0, MAX_VISUAL_OBSERVATIONS).map((sample) => ({
        timeSeconds: sample.timeSeconds,
        description: sample.tags.join('、'),
        subjects: sample.tags,
      })),
    ].slice(0, MAX_VISUAL_OBSERVATIONS),
    ...(matchingVisualEvidence.length > 0 && editingEvidence?.visual
      ? { visualModels: editingEvidence.visual.models }
      : {}),
    ...(transcript
      ? {
          transcript: {
            language: transcript.language,
          segmentCount: transcript.segments.length,
          wordCount: countWords(transcript),
          updatedAt: transcript.updatedAt,
          ...(transcript.provenance ? {
            service: transcript.provenance.service,
            modelId: transcript.provenance.modelId,
            modelVersion: transcript.provenance.modelVersion,
          } : {}),
          },
        }
      : {}),
    audio: { beatStatus: beats ? 'ready' : 'not-requested' },
  }
}

export async function findTranscriptEvidence(
  query: string,
  mediaIds?: readonly string[],
): Promise<Array<{ mediaId: string; startSeconds: number; endSeconds: number; text: string }>> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  const allowedIds = mediaIds ? new Set(mediaIds) : null
  const mediaItems = useMediaLibraryStore.getState().mediaItems
  const matches: Array<{ mediaId: string; startSeconds: number; endSeconds: number; text: string }> = []

  for (const media of mediaItems) {
    if (allowedIds && !allowedIds.has(media.id)) continue
    const transcript = await getTranscript(media.id).catch(() => undefined)
    if (!transcript) continue
    for (const segment of transcript.segments) {
      if (!segment.text.toLocaleLowerCase().includes(normalizedQuery)) continue
      matches.push({
        mediaId: media.id,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      })
      if (matches.length >= MAX_TRANSCRIPT_MATCHES) return matches
    }
  }

  return matches
}

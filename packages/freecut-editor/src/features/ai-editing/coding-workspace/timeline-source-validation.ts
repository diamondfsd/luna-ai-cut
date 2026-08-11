import type { Project, ProjectTimeline } from '@freecut/types/project'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { getLinkedAudioCompanion } from '@freecut/shared/utils/linked-media'
import { assertItemsTrackCompatibility } from '@freecut/features/timeline/utils/track-item-compatibility'

const TRANSFORM_FIELDS = new Set([
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'flipHorizontal',
  'flipVertical',
  'opacity',
  'cornerRadius',
  'aspectRatioLocked',
])

interface TimelineSurface {
  name: string
  timeline: Pick<ProjectTimeline, 'tracks' | 'items'>
  width: number
  height: number
}

function rangesOverlap(left: TimelineItem, right: TimelineItem): boolean {
  return left.from < right.from + right.durationInFrames &&
    right.from < left.from + left.durationInFrames
}

function validateTextTransform(item: TimelineItem, width: number, height: number): void {
  if (item.type !== 'text' || !item.transform) return
  const transform = item.transform as Record<string, unknown>
  const unknown = Object.keys(transform).find((field) => !TRANSFORM_FIELDS.has(field))
  if (unknown) {
    throw new Error(`文字“${item.label}”使用了不支持的 transform 字段“${unknown}”。`)
  }
  for (const [field, value] of Object.entries(transform)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`文字“${item.label}”的 transform.${field} 必须是有限数值。`)
    }
  }
  const x = typeof transform.x === 'number' ? transform.x : 0
  const y = typeof transform.y === 'number' ? transform.y : 0
  const itemWidth = typeof transform.width === 'number' ? transform.width : width
  const itemHeight = typeof transform.height === 'number' ? transform.height : height
  if (itemWidth <= 0 || itemHeight <= 0) {
    throw new Error(`文字“${item.label}”的宽高必须大于 0。`)
  }
  if (Math.abs(x) >= width / 2 || Math.abs(y) >= height / 2) {
    throw new Error(
      `文字“${item.label}”的中心位于画布外。transform.x/y 是相对画布中心的偏移，居中应使用 0。`,
    )
  }
}

function validateTextLayering(
  item: TimelineItem,
  track: TimelineTrack,
  tracks: readonly TimelineTrack[],
  items: readonly TimelineItem[],
): void {
  if (item.type !== 'text') return
  if (track.visible === false || track.muted) {
    throw new Error(`文字“${item.label}”所在轨道“${track.name}”当前不可见。`)
  }
  const orderById = new Map(tracks.map((candidate) => [candidate.id, candidate.order]))
  const coveringVideo = items.find((candidate) =>
    candidate.type === 'video' &&
    rangesOverlap(item, candidate) &&
    (orderById.get(candidate.trackId) ?? 0) < track.order &&
    tracks.find((candidateTrack) => candidateTrack.id === candidate.trackId)?.visible !== false,
  )
  if (coveringVideo) {
    throw new Error(
      `文字“${item.label}”位于视频轨道下方，渲染时会被画面遮住。请把字幕轨道 order 调整为小于视频轨道。`,
    )
  }
}

function validateSurface(
  surface: TimelineSurface,
  mediaHasAudioById: ReadonlyMap<string, boolean>,
): void {
  const tracks = surface.timeline.tracks as TimelineTrack[]
  const items = surface.timeline.items as TimelineItem[]
  assertItemsTrackCompatibility(items, tracks)
  const trackById = new Map(tracks.map((track) => [track.id, track]))

  for (const item of items) {
    const track = trackById.get(item.trackId)
    if (!track) throw new Error(`片段“${item.label}”引用了不存在的轨道。`)
    validateTextTransform(item, surface.width, surface.height)
    validateTextLayering(item, track, tracks, items)
    const linkedAudio = item.type === 'video' ? getLinkedAudioCompanion(items, item) : null
    if (
      item.type === 'video' &&
      item.mediaId &&
      mediaHasAudioById.get(item.mediaId) === true &&
      !item.embeddedAudioMuted &&
      !linkedAudio
    ) {
      throw new Error(
        `视频“${item.label}”包含声音但缺少配对音频片段。请在音频轨创建相同素材、时间和源区间的 audio 片段，并为二者设置相同 linkedGroupId；若要静音请设置 embeddedAudioMuted。`,
      )
    }
    if (item.type === 'video' && linkedAudio && (
      linkedAudio.mediaId !== item.mediaId ||
      linkedAudio.from !== item.from ||
      linkedAudio.durationInFrames !== item.durationInFrames ||
      (linkedAudio.sourceStart ?? 0) !== (item.sourceStart ?? 0) ||
      (linkedAudio.sourceEnd !== undefined || item.sourceEnd !== undefined) &&
        linkedAudio.sourceEnd !== item.sourceEnd
    )) {
      throw new Error(
        `视频“${item.label}”与配对音频的素材、时间或源区间不一致。请让 linkedGroupId 配对的 video/audio 片段保持同步。`,
      )
    }
  }
}

export function validateAiEditingTimelineSource(
  project: Project,
  mediaHasAudioById: ReadonlyMap<string, boolean>,
): void {
  if (!project.timeline) return
  const surfaces: TimelineSurface[] = [{
    name: 'main',
    timeline: project.timeline,
    width: project.metadata.width,
    height: project.metadata.height,
  }]
  for (const composition of project.timeline.compositions ?? []) {
    surfaces.push({
      name: composition.name,
      timeline: composition,
      width: composition.width,
      height: composition.height,
    })
  }
  for (const surface of surfaces) validateSurface(surface, mediaHasAudioById)
}

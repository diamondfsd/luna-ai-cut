import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import type { TimelineItem } from '@freecut/types/timeline'
import { buildProjectEvidence } from '../evidence'
import type {
  AgentCameraMove,
  AgentClip,
  AgentClipRef,
  AgentFraming,
  AgentFramingPose,
  AgentMediaRef,
  AgentTrackRef,
  AgentWorkspaceDocument,
} from '../edit-program/types'

export function mediaRef(id: string): AgentMediaRef {
  return `media:${id}`
}

export function trackRef(id: string): AgentTrackRef {
  return `track:${id}`
}

export function clipRef(id: string): AgentClipRef {
  return `clip:${id}`
}

export function idFromAgentRef(value: string, prefix: 'media' | 'track' | 'clip'): string {
  const expected = `${prefix}:`
  if (!value.startsWith(expected) || value.length === expected.length) {
    throw new Error(`引用“${value}”不符合 ${prefix} 规范。`)
  }
  return value.slice(expected.length)
}

function canvasSize(): { width: number; height: number } {
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

function baseDimensions(
  item: TimelineItem,
  mode: AgentFraming['mode'],
): { width: number; height: number } | null {
  if (item.type !== 'video' && item.type !== 'image') return null
  const sourceWidth = item.sourceWidth
  const sourceHeight = item.sourceHeight
  if (!sourceWidth || !sourceHeight) return null
  const canvas = canvasSize()
  const scale = mode === 'cover'
    ? Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
    : Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}

function poseFromTransform(item: TimelineItem): AgentFramingPose | null {
  const base = baseDimensions(item, 'cover')
  const transform = item.transform
  if (!base || !transform?.width || !transform.height) return null
  return {
    center: [
      Math.max(0, Math.min(1, 0.5 - (transform.x ?? 0) / transform.width)),
      Math.max(0, Math.min(1, 0.5 - (transform.y ?? 0) / transform.height)),
    ],
    zoom: Math.max(1, transform.width / base.width),
    ...(transform.rotation ? { rotation: transform.rotation } : {}),
  }
}

function motionTrackEdge(item: TimelineItem, property: 'x' | 'y' | 'width' | 'height' | 'rotation') {
  const layer = item.motionLayers?.find((candidate) => candidate.sourcePresetId === 'ai-edit-program')
  const track = layer?.tracks.find((candidate) => candidate.property === property)
  if (!track || track.keyframes.length < 2) return null
  const sorted = track.keyframes.toSorted((left, right) => left.frame - right.frame)
  return { first: sorted[0]!, last: sorted.at(-1)! }
}

function cameraMoveFromItem(item: TimelineItem, framing: AgentFraming | undefined): AgentCameraMove | undefined {
  if (!framing || !item.transform?.width || !item.transform.height) return undefined
  const x = motionTrackEdge(item, 'x')
  const y = motionTrackEdge(item, 'y')
  const width = motionTrackEdge(item, 'width')
  const height = motionTrackEdge(item, 'height')
  const rotation = motionTrackEdge(item, 'rotation')
  if (!x && !y && !width && !height && !rotation) return undefined

  const endWidth = item.transform.width * (width?.last.value ?? 1)
  const endHeight = item.transform.height * (height?.last.value ?? 1)
  const endX = (item.transform.x ?? 0) + (x?.last.value ?? 0)
  const endY = (item.transform.y ?? 0) + (y?.last.value ?? 0)
  const base = baseDimensions(item, framing.mode)
  if (!base) return undefined
  const trackEasing = x?.last.easing ?? y?.last.easing ?? width?.last.easing
  const supportedEasing = trackEasing === 'ease-in' || trackEasing === 'ease-out' ||
    trackEasing === 'ease-in-out' || trackEasing === 'linear'
      ? trackEasing
      : 'linear'
  return {
    type: 'move',
    from: framing.pose,
    to: {
      center: [
        Math.max(0, Math.min(1, 0.5 - endX / endWidth)),
        Math.max(0, Math.min(1, 0.5 - endY / endHeight)),
      ],
      zoom: Math.max(1, endWidth / base.width),
      rotation: (item.transform.rotation ?? 0) + (rotation?.last.value ?? 0),
    },
    easing: supportedEasing,
  }
}

function agentClip(item: TimelineItem, fps: number): AgentClip {
  const framingPose = poseFromTransform(item)
  const framing = framingPose ? { mode: 'cover' as const, pose: framingPose } : undefined
  const sourceFps = item.sourceFps || fps
  return {
    ref: clipRef(item.id),
    label: item.label,
    type: item.type,
    trackRef: trackRef(item.trackId),
    start: item.from / fps,
    duration: item.durationInFrames / fps,
    ...(item.mediaId ? { mediaRef: mediaRef(item.mediaId) } : {}),
    ...(item.sourceStart !== undefined && item.sourceEnd !== undefined
      ? { source: { in: item.sourceStart / sourceFps, out: item.sourceEnd / sourceFps, speed: item.speed ?? 1 } }
      : {}),
    ...(framing ? { framing } : {}),
    ...(motionTrackEdge(item, 'x') || motionTrackEdge(item, 'width')
      ? { cameraMove: cameraMoveFromItem(item, framing) }
      : {}),
    ...(item.type === 'text' ? { text: item.text } : {}),
    ...(item.volume !== undefined ? { volumeDb: item.volume } : {}),
  }
}

export async function buildAgentWorkspaceDocument(): Promise<AgentWorkspaceDocument> {
  const evidence = await buildProjectEvidence()
  const timeline = useTimelineStore.getState()
  const project = useProjectStore.getState().currentProject
  const canvas = canvasSize()
  const selected = new Set(useSelectionStore.getState().selectedItemIds)
  const mediaById = useMediaLibraryStore.getState().mediaById

  return {
    schemaVersion: 1,
    revision: evidence.timelineRevision,
    project: {
      id: project?.id ?? 'current',
      title: project?.name ?? '未命名项目',
      width: canvas.width,
      height: canvas.height,
      fps: evidence.fps,
      duration: evidence.durationSeconds,
    },
    viewport: {
      playhead: usePlaybackStore.getState().currentFrame / evidence.fps,
      selectedClipRefs: timeline.items.filter((item) => selected.has(item.id)).map((item) => clipRef(item.id)),
    },
    media: evidence.media.map((entry) => ({
      ref: mediaRef(entry.mediaId),
      name: entry.name,
      kind: entry.kind,
      duration: entry.durationSeconds,
      ...(mediaById[entry.mediaId]?.width ? { width: mediaById[entry.mediaId]!.width } : {}),
      ...(mediaById[entry.mediaId]?.height ? { height: mediaById[entry.mediaId]!.height } : {}),
      ...(mediaById[entry.mediaId]?.audioCodec ? { hasAudio: true } : {}),
      evidence: {
        visual: entry.visual.map((sample) => ({
          time: sample.timeSeconds,
          description: sample.description,
          subjects: sample.subjects,
          ...(sample.action ? { action: sample.action } : {}),
        })),
        ...(entry.transcript
          ? { transcript: {
              language: entry.transcript.language,
              segmentCount: entry.transcript.segmentCount,
              wordCount: entry.transcript.wordCount,
            } }
          : {}),
        audioAnalysis: entry.audio.beatStatus === 'not-requested' ? 'missing' : entry.audio.beatStatus,
      },
    })),
    tracks: evidence.tracks.map((track) => ({
      ref: trackRef(track.id),
      name: track.name,
      kind: track.kind,
      order: track.order,
      locked: track.locked,
      visible: track.visible,
      muted: track.muted,
    })),
    clips: timeline.items.map((item) => agentClip(item, evidence.fps)),
    transitions: timeline.transitions.map((transition) => ({
      ref: `transition:${transition.id}`,
      between: [clipRef(transition.leftClipId), clipRef(transition.rightClipId)],
      presentation: transition.presentation,
      duration: transition.durationInFrames / evidence.fps,
    })),
  }
}

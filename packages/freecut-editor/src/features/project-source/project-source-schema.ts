import type { Project, ProjectTimeline } from '@freecut/types/project'
import type { TextItem, TimelineItem } from '@freecut/types/timeline'
import type { NormalizedTextBox } from './normalized-text-layout'

export const PROJECT_SOURCE_VERSION = 3 as const
export const PROJECT_SOURCE_SEGMENT_SECONDS = 30
export const PROJECT_SOURCE_MAX_CLIPS_PER_SEGMENT = 32

export interface ProjectManifestSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'freecut-project'
  project: Omit<Project, 'timeline'>
  main: string
  components: string
}

export interface SequenceSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'sequence'
  id: string
  state: Omit<
    ProjectTimeline,
    'tracks' | 'items' | 'transitions' | 'keyframes' | 'compositions' | 'topLevelSequenceIds'
  >
  tracks: string[]
  transitions: string
  animations: string
}

export interface TrackSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'track'
  track: ProjectTimeline['tracks'][number]
  segments: Array<{
    path: string
    startFrame: number
    endFrame: number
    clipCount: number
  }>
}

export interface ClipSegmentSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'clip-segment'
  trackId: string
  window: number
  clips: ProjectSourceClip[]
}

type TextSourceTransform = Omit<
  NonNullable<TextItem['transform']>,
  'x' | 'y' | 'width' | 'height' | 'anchorX' | 'anchorY'
>

export type ProjectSourceTextClip = Omit<TextItem, 'transform'> & {
  /** Normalized canvas box. All values and box edges must remain within 0..1. */
  textBox: NormalizedTextBox
  /** Presentation only. Pixel layout and anchor fields are forbidden for text source. */
  transform?: TextSourceTransform
}

export type ProjectSourceClip = Exclude<TimelineItem, TextItem> | ProjectSourceTextClip

export interface TransitionsSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'transitions'
  transitions: NonNullable<ProjectTimeline['transitions']>
}

export interface AnimationsSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'animations'
  keyframes: NonNullable<ProjectTimeline['keyframes']>
}

export interface ComponentIndexSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'component-index'
  topLevelSequenceIds: string[]
  components: Array<{ id: string; path: string }>
}

export interface ComponentSource {
  version: typeof PROJECT_SOURCE_VERSION
  kind: 'component'
  id: string
  state: Omit<
    NonNullable<ProjectTimeline['compositions']>[number],
    'tracks' | 'items' | 'transitions' | 'keyframes'
  >
  tracks: string[]
  transitions: string
  animations: string
}

export interface SequencePartsSource {
  state: unknown
  tracks: string[]
  transitions: string
  animations: string
}

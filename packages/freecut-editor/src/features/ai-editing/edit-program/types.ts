export type AgentMediaRef = `media:${string}`
export type AgentTrackRef = `track:${string}`
export type AgentClipRef = `clip:${string}`

export interface AgentTimeRange {
  start: number
  end: number
}

export interface AgentFramingPose {
  /** Normalized source-space point placed at the canvas center. */
  center: [number, number]
  /** 1 fills the canvas; larger values move closer to the source. */
  zoom: number
  rotation?: number
}

export interface AgentFraming {
  mode: 'cover' | 'contain'
  pose: AgentFramingPose
}

export interface AgentCameraMove {
  type: 'move'
  from: AgentFramingPose
  to: AgentFramingPose
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

export interface AgentMedia {
  ref: AgentMediaRef
  name: string
  kind: 'video' | 'audio' | 'image' | 'other'
  duration: number
  width?: number
  height?: number
  hasAudio?: boolean
  evidence: {
    visual: Array<{
      time: number
      description: string
      subjects: string[]
      action?: string
    }>
    transcript?: {
      language?: string
      segmentCount: number
      wordCount: number
      excerpt: Array<{ start: number; end: number; text: string }>
    }
    audioAnalysis: 'missing' | 'running' | 'ready' | 'unavailable'
  }
}

export interface AgentTrack {
  ref: AgentTrackRef
  name: string
  kind: 'video' | 'audio' | 'subtitle' | 'other'
  order: number
  locked: boolean
  visible?: boolean
  muted?: boolean
}

export interface AgentClip {
  ref: AgentClipRef
  label: string
  type: string
  trackRef: AgentTrackRef
  start: number
  duration: number
  mediaRef?: AgentMediaRef
  source?: { in: number; out: number; speed: number }
  framing?: AgentFraming
  cameraMove?: AgentCameraMove
  text?: string
  textRole?: 'caption'
  textStyle?: AgentTextStyle
  textSpans?: AgentTextSpan[]
  textBox?: AgentTextBox
  subtitle?: AgentSubtitleSummary
  html?: AgentHtmlSummary
  volumeDb?: number
}

export interface AgentSubtitleSummary {
  source: 'transcript' | 'ai-captions' | 'embedded-subtitles' | 'subtitle-import'
  cues: Array<{ start: number; end: number; text: string }>
}

export interface AgentTextStyle {
  fontSize?: number
  fontFamily?: string
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold'
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  color?: string
  backgroundColor?: string
  backgroundRadius?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number
  textPadding?: number
}

export interface AgentTextSpan {
  text: string
  color?: string
  underline?: boolean
}

/** Normalized top-left text box coordinates within the project canvas. */
export interface AgentTextBox {
  left: number
  top: number
  width: number
  height: number
}

export interface AgentHtmlViewport {
  width: number
  height: number
  deviceScaleFactor: number
}

export interface AgentHtmlSummary {
  hash: string
  revision: number
  viewport: AgentHtmlViewport
  renderMode: 'static' | 'animated'
}

export interface AgentWorkspaceDocument {
  schemaVersion: 1
  revision: number
  project: {
    id: string
    title: string
    width: number
    height: number
    fps: number
    duration: number
  }
  viewport: {
    playhead: number
    selectedClipRefs: AgentClipRef[]
  }
  media: AgentMedia[]
  tracks: AgentTrack[]
  clips: AgentClip[]
  transitions: Array<{
    ref: string
    between: [AgentClipRef, AgentClipRef]
    presentation: string
    duration: number
  }>
}

export interface AgentClipDraft {
  ref: string
  mediaRef: AgentMediaRef
  trackRef: AgentTrackRef
  start: number
  duration: number
  label?: string
  source?: { in: number; out: number }
  framing?: AgentFraming
  cameraMove?: AgentCameraMove
}

export interface AgentTextDraft {
  ref: string
  text: string
  start: number
  duration: number
  label?: string
  trackRef?: AgentTrackRef
  role?: 'title' | 'caption'
  style?: AgentTextStyle
  spans?: AgentTextSpan[]
  box?: AgentTextBox
}

export interface AgentHtmlDraft {
  ref: string
  html: string
  css: string
  start: number
  duration: number
  label?: string
  trackRef?: AgentTrackRef
  viewport?: AgentHtmlViewport
  renderMode?: 'static' | 'animated'
}

export interface AgentTransitionDraft {
  between: [string, string]
  transition: AgentTransitionSpec
}

export interface AgentTransitionSpec {
  presentation: string
  duration: number
  direction?: 'from-left' | 'from-right' | 'from-top' | 'from-bottom'
  alignment?: number
}

export type EditOperation =
  | {
      type: 'replaceRange'
      range: AgentTimeRange
      trackRefs?: AgentTrackRef[]
      clips: AgentClipDraft[]
      transitions?: AgentTransitionDraft[]
    }
  | { type: 'insertClip'; clip: AgentClipDraft }
  | { type: 'insertText'; text: AgentTextDraft }
  | { type: 'insertHtml'; html: AgentHtmlDraft }
  | {
      type: 'updateHtml'
      clipRef: AgentClipRef
      expectedRevision: number
      changes: {
        html?: string
        css?: string
        viewport?: AgentHtmlViewport
        renderMode?: 'static' | 'animated'
      }
    }
  | {
      type: 'updateClip'
      clipRef: AgentClipRef
      changes: {
        start?: number
        duration?: number
        trackRef?: AgentTrackRef
        label?: string
        text?: string
        textStyle?: AgentTextStyle
        textSpans?: AgentTextSpan[] | null
        textBox?: AgentTextBox
        framing?: AgentFraming
        cameraMove?: AgentCameraMove | null
        volumeDb?: number
      }
    }
  | { type: 'removeClip'; clipRef: AgentClipRef }
  | { type: 'setTransition'; transition: AgentTransitionSpec | null; between: [string, string] }

export interface EditProgram {
  version: 1
  baseRevision: number
  intent: string
  mode?: 'preview' | 'commit'
  operations: EditOperation[]
}

export interface EditProgramDiff {
  created: AgentClipRef[]
  updated: AgentClipRef[]
  removed: AgentClipRef[]
  changedRanges: AgentTimeRange[]
  transitionsChanged: number
}

export interface EditProgramApplyResult {
  committed: boolean
  revisionBefore: number
  revisionAfter: number
  diff: EditProgramDiff
  warnings: string[]
  workspace: AgentWorkspaceDocument
}

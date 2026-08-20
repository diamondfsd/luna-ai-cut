import {
  FreeCutRuntime,
  type FreeCutCapabilityUnavailableError,
} from './freecut-runtime'
import type {
  FreeCutCapabilityDescriptor,
  FreeCutCapabilityName,
  FreeCutEditRequest,
  FreeCutLayoutRequest,
  FreeCutRenderFrameRequest,
  FreeCutRenderProjectRequest,
  MediaQuery,
  ProjectInspectQuery,
  TimelineQuery,
} from './contracts'

export const FREECUT_CAPABILITIES: readonly FreeCutCapabilityDescriptor[] = [
  { name: 'project.inspect', access: 'read', description: 'Inspect the current FreeCut project' },
  { name: 'project.edit', access: 'write', description: 'Apply a batch of FreeCut edit operations' },
  { name: 'timeline.inspect', access: 'read', description: 'Query tracks, items, transitions and keyframes' },
  { name: 'timeline.add_track', access: 'write', description: 'Create a video or audio timeline track' },
  { name: 'timeline.move_track', access: 'write', description: 'Move a timeline track above or below another track of the same kind' },
  { name: 'timeline.unlink', access: 'write', description: 'Unlink a video from its companion audio without deleting either item' },
  { name: 'timeline.mute', access: 'write', description: 'Mute or unmute timeline audio, including a linked video companion audio item' },
  { name: 'timeline.edit', access: 'write', description: 'Apply timeline edit operations' },
  { name: 'timeline.edit_batch', access: 'write', description: 'Apply an ordered timeline edit batch' },
  { name: 'media.list', access: 'read', description: 'List media available to the current project' },
  { name: 'media.inspect', access: 'read', description: 'Inspect one media metadata record' },
  { name: 'media.read', access: 'read', description: 'Read media metadata and saved transcript evidence' },
  { name: 'media.analyze', access: 'write', description: 'Start transcript or visual media analysis' },
  { name: 'media.get_analysis_task', access: 'read', description: 'Read media analysis task status' },
  { name: 'media.search_transcript', access: 'read', description: 'Search saved transcript segments' },
  { name: 'audio.start_speech', access: 'write', description: 'Start local speech generation' },
  { name: 'audio.start_music', access: 'write', description: 'Start local music or sound-effect generation' },
  { name: 'audio.get_task', access: 'read', description: 'Read audio generation task status' },
  { name: 'render.project', access: 'write', description: 'Render the current project' },
  { name: 'render.frame', access: 'read', description: 'Render one project frame' },
  { name: 'render.layout', access: 'read', description: 'Inspect computed frame layout' },
  { name: 'preview.inspect', access: 'read', description: 'Inspect connected preview state' },
  { name: 'preview.seek', access: 'write', description: 'Seek the connected preview' },
  { name: 'preview.capture_frame', access: 'read', description: 'Capture a frame from the connected preview' },
]

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Capability input must be an object')
  }
  return input as Record<string, unknown>
}

function requireString(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError(`${field} must be a string`)
  return input
}

function readOps(input: Record<string, unknown>): FreeCutEditRequest {
  if (!Array.isArray(input.ops)) throw new TypeError('ops must be an array')
  return { ops: input.ops as Record<string, unknown>[] }
}

/**
 * Host-neutral capability adapter. Electron, Harness and MCP can all wrap
 * this provider; registration and transport remain outside this directory.
 */
export class FreeCutCapabilityProvider {
  readonly namespace = 'freecut'

  constructor(readonly runtime: FreeCutRuntime) {}

  listCapabilities(): readonly FreeCutCapabilityDescriptor[] {
    return FREECUT_CAPABILITIES
  }

  async execute(name: FreeCutCapabilityName, input: unknown = {}): Promise<unknown> {
    const value = asRecord(input)
    switch (name) {
      case 'project.inspect':
        return this.runtime.inspectProject(value as ProjectInspectQuery)
      case 'project.edit':
        return this.runtime.edit(readOps(value))
      case 'timeline.inspect':
        return this.runtime.inspectTimeline(value as TimelineQuery)
      case 'timeline.add_track':
      case 'timeline.move_track':
      case 'timeline.unlink':
      case 'timeline.mute':
        return this.runtime.executeSdkCapability(name, value)
      case 'timeline.edit':
      case 'timeline.edit_batch':
        return this.runtime.editBatch(readOps(value))
      case 'media.list':
        return this.runtime.listMedia(value as MediaQuery)
      case 'media.inspect':
        return this.runtime.inspectMedia(requireString(value.mediaId, 'mediaId'))
      case 'media.read':
      case 'media.analyze':
      case 'media.get_analysis_task':
      case 'media.search_transcript':
      case 'audio.start_speech':
      case 'audio.start_music':
      case 'audio.get_task':
        return this.runtime.executeSdkCapability(name, value)
      case 'render.project':
        return this.runtime.renderProject(value as unknown as FreeCutRenderProjectRequest)
      case 'render.frame':
        return this.runtime.renderFrame(value as unknown as FreeCutRenderFrameRequest)
      case 'render.layout':
        return this.runtime.inspectLayout(value as unknown as FreeCutLayoutRequest)
      case 'preview.inspect':
        return this.runtime.inspectPreview()
      case 'preview.seek':
        return this.runtime.seekPreview(value)
      case 'preview.capture_frame':
        return this.runtime.capturePreviewFrame(value as unknown as FreeCutRenderFrameRequest)
      default:
        return assertNever(name)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported FreeCut capability: ${String(value)}`)
}

export type { FreeCutCapabilityUnavailableError }

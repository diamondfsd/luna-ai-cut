import { editProject, type EditOp } from '@freecut/headless/edit'
import type {
  FreeCutEditRequest,
  FreeCutEditResponse,
  FreeCutHeadlessPort,
  FreeCutLayoutRequest,
  FreeCutLayoutSummary,
  FreeCutMediaSource,
  FreeCutPreviewPort,
  FreeCutPreviewState,
  FreeCutRenderFrameRequest,
  FreeCutRenderProjectRequest,
  FreeCutRenderSummary,
  FreeCutFrameSummary,
  MediaListResult,
  MediaMetadata,
  MediaInspection,
  MediaQuery,
  Project,
  ProjectInspection,
  ProjectInspectQuery,
  TimelineInspection,
  TimelineQuery,
} from './contracts'

export class FreeCutCapabilityUnavailableError extends Error {
  readonly code = 'CAPABILITY_UNAVAILABLE'

  constructor(capability: string) {
    super(`FreeCut capability "${capability}" is not connected`)
    this.name = 'FreeCutCapabilityUnavailableError'
  }
}

export class FreeCutProjectContextError extends Error {
  readonly code = 'PROJECT_CONTEXT_MISMATCH'

  constructor(projectId: string) {
    super(`Project context "${projectId}" does not match the open FreeCut project`)
    this.name = 'FreeCutProjectContextError'
  }
}

interface EditIdCollection {
  affectedIds: Set<string>
  createdIds: Set<string>
  removedIds: Set<string>
}

const ID_FIELDS = [
  'id',
  'itemId',
  'trackId',
  'leftId',
  'rightId',
  'leftClipId',
  'rightClipId',
  'effectId',
  'transitionId',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function addString(set: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) set.add(value)
}

function collectEditIds(
  results: readonly { op: string; detail?: unknown }[],
): EditIdCollection {
  const ids: EditIdCollection = {
    affectedIds: new Set(),
    createdIds: new Set(),
    removedIds: new Set(),
  }

  for (const result of results) {
    if (!result.detail || !isRecord(result.detail)) continue
    for (const field of ID_FIELDS) {
      const value = result.detail[field]
      addString(ids.affectedIds, value)
      if (result.op.startsWith('add')) addString(ids.createdIds, value)
    }

    const removed = result.detail.removed
    if (Array.isArray(removed)) {
      for (const value of removed) {
        addString(ids.affectedIds, value)
        addString(ids.removedIds, value)
      }
    }

    if (result.op === 'removeEffect') addString(ids.removedIds, result.detail.effectId)
    if (result.op === 'removeTransition') addString(ids.removedIds, result.detail.id)
    if (result.op === 'addClip' && Array.isArray(result.detail.created)) {
      for (const created of result.detail.created) {
        if (!isRecord(created)) continue
        addString(ids.affectedIds, created.id)
        addString(ids.createdIds, created.id)
      }
    }
  }

  return ids
}

function toEditOps(ops: readonly Record<string, unknown>[]): EditOp[] {
  return ops.map((op, index) => {
    if (typeof op.op !== 'string') throw new TypeError(`ops[${index}].op must be a string`)
    return op as EditOp
  })
}

type StructuredProjectInspectQuery = ProjectInspectQuery & {
  projectId?: unknown
  includeMedia?: unknown
}

type StructuredMediaListQuery = MediaQuery & {
  projectId?: unknown
  kind?: unknown
  query?: unknown
  limit?: unknown
  offset?: unknown
  mediaIds?: unknown
}

type PublicMediaKind = 'video' | 'audio' | 'image' | 'gif' | 'svg' | 'lottie' | 'unknown'

interface NormalizedMediaQuery {
  ids?: readonly string[]
  search?: string
  mimeTypePrefix?: string
  kind?: PublicMediaKind
  offset: number
  limit?: number
}

function assertProjectContext(projectId: unknown, currentProjectId: string): void {
  if (projectId === undefined) return
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new TypeError('projectId must be a non-empty string')
  }
  if (projectId !== currentProjectId) throw new FreeCutProjectContextError(projectId)
}

function assertOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
  return value
}

function assertStringArray(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings`)
  }
  return value
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`)
  }
  return value
}

function assertPositiveInteger(value: unknown, field: string): number {
  const integer = assertNonNegativeInteger(value, field)
  if (integer === 0) throw new TypeError(`${field} must be greater than zero`)
  return integer
}

function mediaKind(media: MediaMetadata): PublicMediaKind {
  const mimeType = media.mimeType.toLocaleLowerCase()
  const fileName = media.fileName.toLocaleLowerCase()
  if (mimeType === 'image/gif' || fileName.endsWith('.gif')) return 'gif'
  if (mimeType === 'image/svg+xml' || fileName.endsWith('.svg')) return 'svg'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (fileName.endsWith('.lottie') || fileName.endsWith('.json')) return 'lottie'
  return 'unknown'
}

function publicMediaMetadata(media: MediaMetadata, includeAnalysis: boolean): MediaMetadata {
  const result = { ...media }
  delete result.fileHandle
  delete result.opfsPath
  delete result.previewAudioOpfsPath
  delete result.previewAudioMimeType
  delete result.previewAudioConformedAt
  if (!includeAnalysis) delete result.aiCaptions
  return result
}

function publicProject(project: Project, includeTimeline: boolean): Project {
  const result = { ...project }
  delete result.rootFolderHandle
  delete result.rootFolderName
  if (!includeTimeline) delete result.timeline
  return result
}

function normalizeMediaQuery(query: StructuredMediaListQuery): NormalizedMediaQuery {
  const ids = assertStringArray(query.ids ?? query.mediaIds, 'ids')
  const searchValue = query.query ?? query.search
  if (searchValue !== undefined && typeof searchValue !== 'string') {
    throw new TypeError('query must be a string')
  }
  if (query.mimeTypePrefix !== undefined && typeof query.mimeTypePrefix !== 'string') {
    throw new TypeError('mimeTypePrefix must be a string')
  }

  const validKinds: readonly PublicMediaKind[] = ['video', 'audio', 'image', 'gif', 'svg', 'lottie', 'unknown']
  if (query.kind !== undefined && (typeof query.kind !== 'string' || !validKinds.includes(query.kind as PublicMediaKind))) {
    throw new TypeError(`kind must be one of ${validKinds.join(', ')}`)
  }

  return {
    ...(ids ? { ids } : {}),
    ...(typeof searchValue === 'string' && searchValue.trim().length > 0 ? { search: searchValue } : {}),
    ...(typeof query.mimeTypePrefix === 'string' && query.mimeTypePrefix.length > 0
      ? { mimeTypePrefix: query.mimeTypePrefix }
      : {}),
    ...(typeof query.kind === 'string' ? { kind: query.kind as PublicMediaKind } : {}),
    offset: query.offset === undefined ? 0 : assertNonNegativeInteger(query.offset, 'offset'),
    ...(query.limit === undefined ? {} : { limit: assertPositiveInteger(query.limit, 'limit') }),
  }
}

function matchesNormalizedMediaQuery(media: MediaMetadata, query: NormalizedMediaQuery): boolean {
  if (query.ids && !query.ids.includes(media.id)) return false
  if (query.kind && mediaKind(media) !== query.kind) return false
  if (query.mimeTypePrefix && !media.mimeType.startsWith(query.mimeTypePrefix)) return false
  if (query.search) {
    const needle = query.search.trim().toLocaleLowerCase()
    const haystack = [media.fileName, ...media.tags].join(' ').toLocaleLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

function timelineItems(project: Project): NonNullable<Project['timeline']>['items'] {
  return project.timeline?.items ?? []
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function asStringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a string`)
  return value
}

function asFrames(value: unknown, fps: number, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * fps))
  const timecode = asRecord(value, field)
  if (typeof timecode.frames === 'number' && Number.isFinite(timecode.frames)) {
    return Math.max(0, Math.round(timecode.frames))
  }
  if (typeof timecode.seconds === 'number' && Number.isFinite(timecode.seconds)) {
    return Math.max(0, Math.round(timecode.seconds * fps))
  }
  throw new TypeError(`${field} must contain finite seconds or frames`)
}

function secondsValue(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number`)
  }
  return value
}

function legacyTrackQuery(args: Record<string, unknown>, fps: number): TimelineQuery {
  return {
    ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
    ...(typeof args.fromSeconds === 'number' ? { fromFrame: Math.round(args.fromSeconds * fps) } : {}),
    ...(typeof args.toSeconds === 'number' ? { toFrame: Math.round(args.toSeconds * fps) } : {}),
  }
}

function mediaSourceRangeOps(
  media: MediaMetadata,
  args: Record<string, unknown>,
  fps: number,
  callerId: string,
): Record<string, unknown>[] {
  const startSeconds = secondsValue(args.startSeconds, 'startSeconds', 0)
  const sourceStartSeconds = secondsValue(args.sourceStartSeconds, 'sourceStartSeconds', 0)
  const sourceEndSeconds = args.sourceEndSeconds === undefined
    ? undefined
    : secondsValue(args.sourceEndSeconds, 'sourceEndSeconds')
  const durationSeconds = sourceEndSeconds !== undefined
    ? sourceEndSeconds - sourceStartSeconds
    : secondsValue(args.durationSeconds, 'durationSeconds', media.duration)
  if (durationSeconds <= 0) throw new TypeError('sourceEndSeconds must be after sourceStartSeconds')
  const sourceFps = media.fps > 0 ? media.fps : fps
  const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps))
  const sourceStart = Math.max(0, Math.round(sourceStartSeconds * sourceFps))
  const sourceEnd = Math.min(sourceDuration, Math.round((sourceStartSeconds + durationSeconds) * sourceFps))
  if (sourceEnd <= sourceStart) throw new TypeError('The requested media range is empty')

  const ops: Record<string, unknown>[] = [{
    op: 'addClip',
    callerId,
    mediaId: media.id,
    from: Math.round(startSeconds * fps),
    durationInFrames: Math.max(1, Math.round(durationSeconds * fps)),
    ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
  }]
  const sourceUpdates = { sourceStart, sourceEnd, sourceDuration, sourceFps }
  // addClip creates the primary item first and a linked audio item second when
  // the source has an audio stream. Apply the same source window to both.
  ops.push({
    op: 'updateItem',
    id: { $ref: `${callerId}#/detail/created/0/id` },
    updates: sourceUpdates,
  })
  if (media.audioCodec) {
    ops.push({
      op: 'updateItem',
      id: { $ref: `${callerId}#/detail/created/1/id` },
      updates: sourceUpdates,
    })
  }
  return ops
}

function coreOperationForCapability(
  name: string,
  args: Record<string, unknown>,
  fps: number,
): Record<string, unknown> {
  switch (name) {
    case 'timeline.tracks.add':
      return {
        op: 'addTrack',
        kind: args.type === 'audio' ? 'audio' : 'video',
        ...(typeof args.index === 'number' ? { order: args.index } : {}),
      }
    case 'timeline.clips.add':
      return {
        op: 'addClip',
        mediaId: asStringValue(args.mediaId, 'mediaId'),
        from: asFrames(args.start, fps, 'start'),
        durationInFrames: asFrames(args.duration, fps, 'duration'),
        ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
      }
    case 'timeline.clips.update': {
      const updates = asRecord(args.properties ?? {}, 'properties')
      if (args.start !== undefined) updates.from = asFrames(args.start, fps, 'start')
      if (args.duration !== undefined) updates.durationInFrames = asFrames(args.duration, fps, 'duration')
      if (typeof args.speed === 'number') updates.speed = args.speed
      if (typeof args.reverse === 'boolean') updates.reverse = args.reverse
      return { op: 'updateItem', id: asStringValue(args.clipId, 'clipId'), updates }
    }
    case 'timeline.clips.move':
      return {
        op: 'moveItem',
        id: asStringValue(args.clipId, 'clipId'),
        from: asFrames(args.start, fps, 'start'),
        ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
      }
    case 'timeline.clips.delete':
      if (args.mode === 'ripple' || args.mode === 'lift') {
        throw new Error(`Clip delete mode "${String(args.mode)}" is not available in the current headless adapter`)
      }
      return { op: 'removeItems', ids: [asStringValue(args.clipId, 'clipId')] }
    case 'timeline.clips.split':
      return {
        op: 'split',
        id: asStringValue(args.clipId, 'clipId'),
        frame: asFrames(args.at, fps, 'at'),
      }
    case 'timeline.clips.trim':
      if (args.mode && args.mode !== 'normal') {
        throw new Error(`Clip trim mode "${String(args.mode)}" is not available in the current headless adapter`)
      }
      return {
        op: args.edge === 'start' ? 'trimStart' : 'trimEnd',
        id: asStringValue(args.clipId, 'clipId'),
        amount: asFrames(args.amount, fps, 'amount'),
      }
    case 'timeline.clips.setTransform':
      return {
        op: 'setTransform',
        id: asStringValue(args.clipId, 'clipId'),
        transform: asRecord(args.transform, 'transform'),
      }
    case 'timeline.clips.setAudio':
      return {
        op: 'updateItem',
        id: asStringValue(args.clipId, 'clipId'),
        updates: asRecord(args.audio, 'audio'),
      }
    case 'timeline.effects.add':
      return {
        op: 'addEffect',
        itemId: asStringValue(args.clipId, 'clipId'),
        gpuEffectType: asStringValue(args.type, 'type'),
        params: asRecord(args.params ?? {}, 'params'),
      }
    case 'timeline.effects.remove':
      return {
        op: 'removeEffect',
        itemId: asStringValue(args.clipId, 'clipId'),
        effectId: asStringValue(args.effectId, 'effectId'),
      }
    case 'timeline.keyframes.add':
      if (typeof args.value !== 'number') throw new Error('Current headless keyframe adapter requires a numeric value')
      return {
        op: 'addKeyframe',
        itemId: asStringValue(args.clipId, 'clipId'),
        property: asStringValue(args.property, 'property'),
        frame: asFrames(args.at, fps, 'at'),
        value: args.value,
        ...(typeof args.easing === 'string' ? { easing: args.easing } : {}),
      }
    case 'timeline.text.add':
      return {
        op: 'addText',
        ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
        from: asFrames(args.start, fps, 'start'),
        durationInFrames: asFrames(args.duration, fps, 'duration'),
        text: asStringValue(args.text, 'text'),
        ...asRecord(args.style ?? {}, 'style'),
      }
    case 'timeline.transitions.add':
      return {
        op: 'addTransition',
        leftClipId: asStringValue(args.fromClipId, 'fromClipId'),
        rightClipId: asStringValue(args.toClipId, 'toClipId'),
        type: asStringValue(args.type, 'type'),
        durationInFrames: asFrames(args.duration, fps, 'duration'),
        ...(typeof args.direction === 'string' ? { direction: args.direction } : {}),
        ...(args.properties !== undefined ? { properties: asRecord(args.properties, 'properties') } : {}),
      }
    case 'timeline.effects.update':
      return {
        op: 'updateEffect',
        itemId: asStringValue(args.clipId, 'clipId'),
        effectId: asStringValue(args.effectId, 'effectId'),
        ...(args.params !== undefined ? { params: asRecord(args.params, 'params') } : {}),
        ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
      }
    case 'timeline.keyframes.update':
      return {
        op: 'updateKeyframe',
        itemId: asStringValue(args.clipId, 'clipId'),
        property: asStringValue(args.property, 'property'),
        keyframeId: asStringValue(args.keyframeId, 'keyframeId'),
        updates: {
          ...(args.at !== undefined ? { frame: asFrames(args.at, fps, 'at') } : {}),
          ...(args.value !== undefined ? { value: args.value } : {}),
          ...(typeof args.easing === 'string' ? { easing: args.easing } : {}),
        },
      }
    case 'timeline.keyframes.remove':
      return {
        op: 'removeKeyframe',
        itemId: asStringValue(args.clipId, 'clipId'),
        property: asStringValue(args.property, 'property'),
        keyframeId: asStringValue(args.keyframeId, 'keyframeId'),
      }
    case 'timeline.transitions.update':
      return {
        op: 'updateTransition',
        id: asStringValue(args.transitionId, 'transitionId'),
        ...(args.duration !== undefined ? { durationInFrames: asFrames(args.duration, fps, 'duration') } : {}),
        ...(typeof args.type === 'string' ? { presentation: args.type } : {}),
        ...(typeof args.direction === 'string' ? { direction: args.direction } : {}),
        ...(args.properties !== undefined ? { properties: asRecord(args.properties, 'properties') } : {}),
      }
    case 'timeline.transitions.remove':
      return {
        op: 'removeTransition',
        id: asStringValue(args.transitionId, 'transitionId'),
      }
    default:
      throw new FreeCutCapabilityUnavailableError(name)
  }
}

/**
 * Runtime adapter for the FreeCut core.
 *
 * This class owns only the SDK-facing context. Timeline mutations are always
 * delegated to the existing headless edit entry, which hydrates and drives the
 * real timeline actions before serializing a new Project.
 */
export class FreeCutRuntime {
  private project: Project
  private readonly mediaById = new Map<string, MediaMetadata>()
  private readonly mediaSourcesById = new Map<string, FreeCutMediaSource>()
  private readonly headless?: FreeCutHeadlessPort
  private readonly preview?: FreeCutPreviewPort
  private editQueue: Promise<void> = Promise.resolve()

  constructor(options: import('./contracts').FreeCutRuntimeOptions) {
    this.project = options.project
    this.headless = options.headless
    this.preview = options.preview
    this.setMedia(options.media ?? [])
    this.setMediaSources(options.mediaSources ?? [])
  }

  getProject(): Project {
    return this.project
  }

  setProject(project: Project): void {
    this.project = project
  }

  setMedia(media: readonly MediaMetadata[]): void {
    for (const metadata of media) this.mediaById.set(metadata.id, metadata)
  }

  setMediaSources(sources: readonly FreeCutMediaSource[]): void {
    for (const source of sources) {
      this.mediaSourcesById.set(source.mediaId, source)
      if (source.metadata) this.mediaById.set(source.metadata.id, source.metadata)
    }
  }

  inspectProject(query: StructuredProjectInspectQuery = {}): ProjectInspection & { media?: MediaMetadata[] } {
    assertProjectContext(query.projectId, this.project.id)
    const includeTimeline = assertOptionalBoolean(query.includeTimeline, 'includeTimeline') ?? true
    const includeMedia = assertOptionalBoolean(query.includeMedia, 'includeMedia') ?? false
    const timeline = this.project.timeline
    const project = publicProject(this.project, includeTimeline)
    return {
      project,
      timeline: includeTimeline ? project.timeline : undefined,
      counts: {
        tracks: timeline?.tracks.length ?? 0,
        items: timeline?.items.length ?? 0,
        transitions: timeline?.transitions?.length ?? 0,
        keyframes: timeline?.keyframes?.length ?? 0,
        compositions: timeline?.compositions?.length ?? 0,
      },
      ...(includeMedia ? { media: this.listMedia().media } : {}),
    }
  }

  inspectTimeline(query: TimelineQuery = {}): TimelineInspection {
    const timeline = this.project.timeline
    const tracks = timeline?.tracks ?? []
    const allItems = timelineItems(this.project)
    const itemIds = query.itemIds ? new Set(query.itemIds) : undefined
    const items = allItems.filter((item) => {
      if (query.trackId && item.trackId !== query.trackId) return false
      if (itemIds && !itemIds.has(item.id)) return false
      if (query.fromFrame !== undefined && item.from + item.durationInFrames < query.fromFrame)
        return false
      if (query.toFrame !== undefined && item.from > query.toFrame) return false
      return true
    })
    const selectedIds = new Set(items.map((item) => item.id))
    const transitions = (timeline?.transitions ?? []).filter((transition) => {
      if (selectedIds.size === 0 && (query.itemIds || query.trackId)) return false
      if (!query.itemIds) return true
      return selectedIds.has(transition.leftClipId) || selectedIds.has(transition.rightClipId)
    })

    return {
      projectId: this.project.id,
      fps: this.project.metadata.fps,
      currentFrame: timeline?.currentFrame ?? 0,
      ...(timeline?.inPoint !== undefined ? { inPoint: timeline.inPoint } : {}),
      ...(timeline?.outPoint !== undefined ? { outPoint: timeline.outPoint } : {}),
      tracks: query.trackId ? tracks.filter((track) => track.id === query.trackId) : tracks,
      items,
      transitions,
      keyframes: timeline?.keyframes ?? [],
      compositions: timeline?.compositions ?? [],
    }
  }

  listMedia(query: StructuredMediaListQuery = {}): MediaListResult {
    assertProjectContext(query.projectId, this.project.id)
    const normalized = normalizeMediaQuery(query)
    const matching = [...this.mediaById.values()].filter((entry) => matchesNormalizedMediaQuery(entry, normalized))
    const media = matching
      .slice(normalized.offset, normalized.limit === undefined ? undefined : normalized.offset + normalized.limit)
      .map((entry) => publicMediaMetadata(entry, false))
    return { media, total: matching.length }
  }

  inspectMedia(mediaId: string): MediaInspection {
    const media = this.mediaById.get(mediaId)
    if (!media) throw new Error(`Media "${mediaId}" does not exist`)
    return { media: publicMediaMetadata(media, true) }
  }

  readMedia(args: Record<string, unknown>): MediaInspection & { items?: MediaMetadata[] } {
    assertProjectContext(args.projectId, this.project.id)
    const ids = new Set<string>()
    if (args.mediaId !== undefined) ids.add(asStringValue(args.mediaId, 'mediaId'))
    const batchIds = assertStringArray(args.mediaIds, 'mediaIds')
    for (const mediaId of batchIds ?? []) ids.add(mediaId)
    if (ids.size === 0) throw new TypeError('mediaId or mediaIds must be provided')

    const items = [...ids].map((mediaId) => {
      const media = this.mediaById.get(mediaId)
      if (!media) throw new Error(`Media "${mediaId}" does not exist`)
      return publicMediaMetadata(media, true)
    })
    if (batchIds !== undefined) return { media: items[0]!, items }
    return { media: items[0]! }
  }

  async edit(request: FreeCutEditRequest): Promise<FreeCutEditResponse> {
    const run = async (): Promise<FreeCutEditResponse> => {
      if (request.media) this.setMedia(request.media)
      const result = await editProject({
        project: this.project,
        ops: toEditOps(request.ops),
        media: [...this.mediaById.values()].map((metadata) => ({
          mediaId: metadata.id,
          metadata,
        })),
      })
      this.project = result.project
      const ids = collectEditIds(result.results)
      return {
        project: result.project,
        applied: result.applied,
        results: result.results,
        affectedIds: [...ids.affectedIds],
        createdIds: [...ids.createdIds],
        removedIds: [...ids.removedIds],
        warnings: [],
      }
    }

    // editProject uses module-level stores. Serialize calls made through one
    // runtime so concurrent scripts cannot hydrate each other's project.
    const next = this.editQueue.then(run, run)
    this.editQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  editBatch(request: FreeCutEditRequest): Promise<FreeCutEditResponse> {
    return this.edit(request)
  }

  async executeSdkCapability(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case 'project.inspect':
        return this.inspectProject(args as StructuredProjectInspectQuery)
      case 'timeline.inspect':
        return this.inspectTimeline({
          ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
          ...(Array.isArray(args.trackIds) ? { trackId: args.trackIds[0] as string | undefined } : {}),
          ...(Array.isArray(args.clipIds) ? { itemIds: args.clipIds as string[] } : {}),
          ...(Array.isArray(args.itemIds) ? { itemIds: args.itemIds as string[] } : {}),
        })
      case 'media.list':
        return this.listMedia(args as StructuredMediaListQuery)
      case 'media.inspect':
        assertProjectContext(args.projectId, this.project.id)
        return this.inspectMedia(asStringValue(args.mediaId, 'mediaId'))
      case 'media.read': {
        return this.readMedia(args)
      }
      case 'timeline.inspect_context':
        return this.inspectTimeline(legacyTrackQuery(args, this.project.metadata.fps))
      case 'timeline.add_media': {
        const media = this.mediaById.get(asStringValue(args.mediaId, 'mediaId'))
        if (!media) throw new Error(`Media "${String(args.mediaId)}" does not exist`)
        return this.edit({ ops: mediaSourceRangeOps(media, args, this.project.metadata.fps, 'add-media') })
      }
      case 'timeline.add_media_batch': {
        if (!Array.isArray(args.items) || args.items.length === 0) throw new TypeError('items must be a non-empty array')
        const ops: Record<string, unknown>[] = []
        for (const [index, raw] of args.items.entries()) {
          const item = asRecord(raw, `items[${index}]`)
          const media = this.mediaById.get(asStringValue(item.mediaId, `items[${index}].mediaId`))
          if (!media) throw new Error(`Media "${String(item.mediaId)}" does not exist`)
          ops.push(...mediaSourceRangeOps(media, item, this.project.metadata.fps, `add-media-${index}`))
        }
        return this.edit({ ops })
      }
      case 'timeline.trim': {
        const itemId = asStringValue(args.itemId, 'itemId')
        const item = timelineItems(this.project).find((candidate) => candidate.id === itemId)
        if (!item) throw new Error(`Timeline item "${itemId}" does not exist`)
        const fps = this.project.metadata.fps
        const ops: Record<string, unknown>[] = []
        if (args.startSeconds !== undefined) {
          ops.push({ op: 'trimStart', id: itemId, amount: Math.round(secondsValue(args.startSeconds, 'startSeconds') * fps) - item.from })
        }
        if (args.endSeconds !== undefined) {
          ops.push({ op: 'trimEnd', id: itemId, amount: Math.round(secondsValue(args.endSeconds, 'endSeconds') * fps) - (item.from + item.durationInFrames) })
        }
        if (ops.length === 0) throw new TypeError('timeline.trim requires startSeconds or endSeconds')
        return this.edit({ ops })
      }
      case 'timeline.split':
        return this.edit({ ops: [{
          op: 'split',
          id: asStringValue(args.itemId, 'itemId'),
          frame: Math.round(secondsValue(args.atSeconds, 'atSeconds') * this.project.metadata.fps),
        }] })
      case 'timeline.move':
        return this.edit({ ops: [{
          op: 'moveItem',
          id: asStringValue(args.itemId, 'itemId'),
          from: Math.round(secondsValue(args.toSeconds, 'toSeconds') * this.project.metadata.fps),
          ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
        }] })
      case 'timeline.remove':
        if (!Array.isArray(args.itemIds) || args.itemIds.length === 0) throw new TypeError('itemIds must be a non-empty array')
        return this.edit({ ops: [{ op: 'removeItems', ids: args.itemIds }] })
      case 'timeline.set_properties': {
        const updates = Object.fromEntries(
          ['label', 'text', 'volume', 'speed', 'fadeIn', 'fadeOut'].filter((field) => args[field] !== undefined).map((field) => [field, args[field]]),
        )
        return this.edit({ ops: [{ op: 'updateItem', id: asStringValue(args.itemId, 'itemId'), updates }] })
      }
      case 'timeline.set_transform': {
        const itemId = asStringValue(args.itemId, 'itemId')
        const transform = Object.fromEntries(
          ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'flipHorizontal', 'flipVertical', 'cornerRadius'].filter((field) => args[field] !== undefined).map((field) => [field, args[field]]),
        )
        return this.edit({ ops: [{ op: 'setTransform', id: itemId, transform }] })
      }
      case 'timeline.set_audio':
        return this.edit({ ops: [{ op: 'updateItem', id: asStringValue(args.itemId, 'itemId'), updates: Object.fromEntries(
          ['volume', 'fadeIn', 'fadeOut', 'pitchSemitones'].filter((field) => args[field] !== undefined).map((field) => [field, args[field]]),
        ) }] })
      case 'timeline.add_text':
        return this.edit({ ops: [coreOperationForCapability('timeline.text.add', {
          ...args,
          start: args.startSeconds,
          duration: args.durationSeconds,
          text: args.text,
        }, this.project.metadata.fps)] })
      case 'timeline.add_keyframe':
        return this.edit({ ops: [coreOperationForCapability('timeline.keyframes.add', {
          ...args,
          clipId: args.itemId,
          at: args.atSeconds,
        }, this.project.metadata.fps)] })
      case 'timeline.add_transition':
        return this.edit({ ops: [coreOperationForCapability('timeline.transitions.add', {
          ...args,
          fromClipId: args.leftItemId,
          toClipId: args.rightItemId,
          type: args.presentation ?? 'fade',
          duration: args.durationSeconds ?? 0.5,
        }, this.project.metadata.fps)] })
      case 'timeline.add_html':
        throw new FreeCutCapabilityUnavailableError('timeline.add_html')
      case 'project.set_canvas':
        throw new FreeCutCapabilityUnavailableError('project.set_canvas')
      case 'audio.start_speech':
      case 'audio.start_music':
      case 'audio.get_task':
      case 'media.analyze':
      case 'media.get_analysis_task':
        throw new FreeCutCapabilityUnavailableError(name)
      case 'media.search_transcript':
      case 'media.searchTranscript': {
        const query = asStringValue(args.query, 'query').toLocaleLowerCase()
        const ids = Array.isArray(args.mediaIds)
          ? new Set(args.mediaIds.filter((value): value is string => typeof value === 'string'))
          : typeof args.mediaId === 'string' ? new Set([args.mediaId]) : undefined
        const matches = [...this.mediaById.values()].flatMap((media) => {
          if (ids && !ids.has(media.id)) return []
          return (media.aiCaptions ?? [])
            .filter((caption) => caption.text.toLocaleLowerCase().includes(query))
            .map((caption, index) => ({
              mediaId: media.id,
              segmentId: `${media.id}-caption-${index}`,
              text: caption.text,
              start: caption.timeSec,
              end: caption.timeSec,
            }))
        })
        return name === 'media.search_transcript' ? { matches } : matches
      }
      case 'project.edit':
      case 'timeline.edit':
      case 'timeline.edit_batch': {
        if (!Array.isArray(args.ops)) throw new TypeError('ops must be an array')
        return this.edit({
          ops: args.ops as Record<string, unknown>[],
          ...(Array.isArray(args.media) ? { media: args.media as MediaMetadata[] } : {}),
        })
      }
      default:
        return this.edit({ ops: [coreOperationForCapability(name, args, this.project.metadata.fps)] })
    }
  }

  async renderProject(request: FreeCutRenderProjectRequest): Promise<FreeCutRenderSummary> {
    if (!this.headless) throw new FreeCutCapabilityUnavailableError('render.project')
    return this.headless.renderProject({
      ...request,
      project: this.project,
      media: request.media ?? [...this.mediaSourcesById.values()],
    })
  }

  async renderFrame(request: FreeCutRenderFrameRequest = {}): Promise<FreeCutFrameSummary> {
    if (!this.headless) throw new FreeCutCapabilityUnavailableError('render.frame')
    return this.headless.renderFrame({
      ...request,
      project: this.project,
      media: request.media ?? [...this.mediaSourcesById.values()],
    })
  }

  async inspectLayout(request: FreeCutLayoutRequest = {}): Promise<FreeCutLayoutSummary> {
    if (!this.headless) throw new FreeCutCapabilityUnavailableError('render.layout')
    return this.headless.dumpLayout({
      ...request,
      project: this.project,
      media: request.media ?? [...this.mediaSourcesById.values()],
    })
  }

  async inspectPreview(): Promise<FreeCutPreviewState> {
    if (!this.preview) throw new FreeCutCapabilityUnavailableError('preview.inspect')
    return this.preview.inspect()
  }

  async seekPreview(input: { frame?: number; atSeconds?: number }): Promise<unknown> {
    if (!this.preview) throw new FreeCutCapabilityUnavailableError('preview.seek')
    return this.preview.seek(input)
  }

  async capturePreviewFrame(input: FreeCutRenderFrameRequest = {}): Promise<unknown> {
    if (!this.preview) throw new FreeCutCapabilityUnavailableError('preview.capture_frame')
    return this.preview.captureFrame(input)
  }
}

/**
 * Headless programmatic editing.
 *
 * Hydrates the real timeline domain stores from a Project, applies a list of
 * edit ops by driving the REAL timeline action modules (so transition repair,
 * track ordering, split-id rebinding, undo bookkeeping etc. all behave exactly
 * like the editor), then serializes the stores back to a Project. No workspace
 * storage layer is required.
 */
import type { Project } from '@freecut/types/project'
import type {
  TimelineItem,
  TimelineTrack,
  TextItem,
  VideoItem,
  AudioItem,
  ImageItem,
} from '@freecut/types/timeline'
import type { MediaMetadata } from '@freecut/types/storage'
import type { Transition } from '@freecut/types/transition'
import type { AnimatableProperty, EasingType } from '@freecut/types/keyframe'
import type { VisualEffect } from '@freecut/types/effects'
import type { TransformProperties } from '@freecut/types/transform'

import { createLogger } from '@freecut/shared/logging/logger'
import { migrateProject } from '@freecut/shared/projects/migrations'
import {
  hydrateTimelineStoresFromProject,
  buildTimelineFromStores,
} from '@freecut/features/timeline/stores/timeline-persistence'
import { useItemsStore } from '@freecut/features/timeline/stores/items-store'
import { useTransitionsStore } from '@freecut/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@freecut/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@freecut/features/timeline/utils/classic-tracks'
import { seedMediaLibrary } from './seed-media'
import {
  addItem,
  updateItem,
  moveItem,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  updateTransition,
  removeTransition,
  setTransformParent,
  addKeyframes,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateItemTransform,
} from '@freecut/features/timeline/stores/timeline-actions'
import { getGpuEffect } from '@freecut/infrastructure/gpu-effects'

const log = createLogger('HeadlessEdit')

export type EditOperationName =
  | 'addText'
  | 'addItem'
  | 'updateItem'
  | 'moveItem'
  | 'removeItems'
  | 'split'
  | 'trimStart'
  | 'trimEnd'
  | 'addTransition'
  | 'updateTransition'
  | 'removeTransition'
  | 'addTrack'
  | 'addClip'
  | 'addKeyframe'
  | 'removeKeyframes'
  | 'setTransformParent'
  | 'addEffect'
  | 'removeEffect'
  | 'setTransform'

/** A wire operation. Node validates its discriminator and fields before this browser boundary. */
export type EditOp = Record<string, unknown> & { op: EditOperationName }

export interface HeadlessEditInput {
  project: Project
  ops: EditOp[]
  /** MediaMetadata for any media referenced by ops (e.g. addClip), keyed for codec/fps/duration lookups. */
  media?: Array<{ mediaId: string; metadata?: MediaMetadata }>
}

export interface HeadlessEditResult {
  ok: true
  /** The edited project (timeline rebuilt from stores). The driver writes this to disk. */
  project: Project
  applied: number
  results: Array<{ callerId?: string; op: string; ok: boolean; detail?: unknown; error?: string }>
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error(`Invalid result JSON pointer "${pointer}"`)
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`Result reference pointer not found: ${pointer}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const REFERENCE_ID_FIELDS = new Set([
  'id',
  'itemId',
  'trackId',
  'leftClipId',
  'rightClipId',
  'effectId',
  'mediaId',
])

function resolveOperationRefs(
  op: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
): EditOp {
  const visit = (value: unknown, field?: string): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
      if (!field || !REFERENCE_ID_FIELDS.has(field))
        throw new Error(`$ref is not allowed in field "${field ?? '$'}"`)
      const ref = (value as { $ref?: unknown }).$ref
      if (typeof ref !== 'string') throw new Error('$ref must be a string')
      const match = /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref)
      if (!match) throw new Error(`Invalid result reference: ${ref}`)
      const result = prior.get(match[1]!)
      if (!result?.ok)
        throw new Error(`Result reference is not a prior successful operation: ${match[1]}`)
      const resolved = resolvePointer(result, match[2]!)
      if (typeof resolved !== 'string')
        throw new Error(`Result reference must resolve to an id string: ${ref}`)
      return resolved
    }
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, field === 'ids' ? 'id' : field))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, key)]),
      )
    }
    return value
  }
  return visit(op) as EditOp
}

// Canvas of the project being edited (set per editProject call) — transform-parent
// binds resolve world transforms against it.
let editCanvas = { width: 1920, height: 1080, fps: 30 }

const asString = (value: unknown, fallback?: string): string | undefined =>
  typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function tracks(): TimelineTrack[] {
  return useItemsStore.getState().tracks
}

function requireItem(id: string, field = 'id'): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`${field}: item "${id}" does not exist`)
  return item
}

function requireTransition(id: string, field = 'id'): Transition {
  const transition = useTransitionsStore.getState().transitions.find((t) => t.id === id)
  if (!transition) throw new Error(`${field}: transition "${id}" does not exist`)
  return transition
}

/**
 * Confirm an `updateTransition` actually landed.
 *
 * `updateTransition` runs handle validation for `durationInFrames` / `alignment`
 * and, on rejection, only logs — its signature is `void`, so a caller cannot tell
 * a rejected edit from an applied one. Comparing against the post-update state
 * catches every rejection path, present and future, without changing the shared
 * store API.
 */
function assertTransitionUpdateApplied(
  id: string,
  updates: Parameters<typeof updateTransition>[1],
): void {
  const applied = requireTransition(id)
  const rejected = Object.entries(updates)
    .filter(([field, requested]) => {
      const actual = (applied as unknown as Record<string, unknown>)[field]
      // `properties` is a plain object; the rest are scalars.
      return JSON.stringify(actual) !== JSON.stringify(requested)
    })
    .map(([field, requested]) => `${field}=${JSON.stringify(requested)}`)

  if (rejected.length === 0) return
  throw new Error(
    `updateTransition("${id}") was rejected: ${rejected.join(', ')} — the transition is unchanged. ` +
      'Duration and alignment must fit the handles available on both clips.',
  )
}

function requireTrack(id: string, field = 'trackId'): TimelineTrack {
  const track = tracks().find((candidate) => candidate.id === id)
  if (!track) throw new Error(`${field}: track "${id}" does not exist`)
  if (track.isGroup) throw new Error(`${field}: track "${id}" is a group and cannot contain items`)
  return track
}

/** Resolve a usable trackId: the requested one if it exists, else the first non-group video track. */
function resolveTrackId(preferred: unknown, kind: 'video' | 'audio' = 'video'): string {
  const all = tracks()
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  const match = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  const fallback = match ?? all.find((t) => !t.isGroup)
  if (!fallback) throw new Error('No track available to place item on (add a track first)')
  return fallback.id
}

function newId(): string {
  return crypto.randomUUID()
}

/** Find a non-group track of the given kind, or create one (video on top, audio at bottom). */
function getOrCreateTrack(kind: 'video' | 'audio'): string {
  const all = tracks()
  const existing = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  if (existing) return existing.id
  const orders = all.map((t) => t.order)
  const order = kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1
  const track = createClassicTrack({ tracks: all, kind, order })
  setTracks([...all, track])
  return track.id
}

/** The requested track if it exists, else find-or-create one of the given kind. */
function resolveOrCreateTrack(preferred: unknown, kind: 'video' | 'audio'): string {
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  return getOrCreateTrack(kind)
}

/** Source-frame fields for a media clip (source* are in source-native fps). */
function sourceFieldsFor(media: MediaMetadata, projectFps: number) {
  const sourceFps = media.fps && media.fps > 0 ? media.fps : projectFps
  const durationSec = media.duration ?? 0
  const sourceEnd = Math.max(1, Math.round(durationSec * sourceFps))
  return { sourceFps, sourceStart: 0, sourceEnd, sourceDuration: sourceEnd, speed: 1 }
}

function buildTextItem(op: EditOp): TextItem {
  return {
    id: asString(op.id) ?? newId(),
    type: 'text',
    trackId: resolveTrackId(op.trackId, 'video'),
    from: asNumber(op.from, 0)!,
    durationInFrames: asNumber(op.durationInFrames, 90)!,
    label: asString(op.label) ?? 'Text',
    text: asString(op.text) ?? 'Text',
    color: asString(op.color) ?? '#ffffff',
    fontSize: asNumber(op.fontSize, 80)!,
    ...(asString(op.fontFamily) && { fontFamily: asString(op.fontFamily) }),
    ...(op.fontWeight === 'bold' || op.fontWeight === 'semibold' || op.fontWeight === 'medium'
      ? { fontWeight: op.fontWeight }
      : {}),
    ...(op.textAlign === 'left' || op.textAlign === 'center' || op.textAlign === 'right'
      ? { textAlign: op.textAlign }
      : {}),
    ...(op.verticalAlign === 'top' || op.verticalAlign === 'middle' || op.verticalAlign === 'bottom'
      ? { verticalAlign: op.verticalAlign }
      : {}),
  }
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
function applyOp(op: EditOp): unknown {
  switch (op.op) {
    case 'addText': {
      const item = buildTextItem(op)
      addItem(item)
      return { id: item.id }
    }
    case 'addItem': {
      const item = op.item as TimelineItem | undefined
      if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
      const withId: TimelineItem = { ...item, id: item.id || newId() }
      requireTrack(withId.trackId, 'item.trackId')
      addItem(withId)
      return { id: withId.id }
    }
    case 'updateItem': {
      const id = asString(op.id)
      if (!id) throw new Error('updateItem requires `id`')
      requireItem(id)
      const updates = (op.updates ?? {}) as Partial<TimelineItem>
      if (updates.trackId) requireTrack(updates.trackId, 'updates.trackId')
      updateItem(id, updates)
      return { id }
    }
    case 'moveItem': {
      const id = asString(op.id)
      const from = asNumber(op.from)
      if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
      requireItem(id)
      const destination = asString(op.trackId)
      if (destination) requireTrack(destination)
      moveItem(id, from, destination)
      return { id, from }
    }
    case 'removeItems': {
      const ids = Array.isArray(op.ids)
        ? (op.ids.filter((x) => typeof x === 'string') as string[])
        : []
      if (ids.length === 0) throw new Error('removeItems requires non-empty `ids`')
      for (const id of ids) requireItem(id, 'ids')
      removeItems(ids)
      return { removed: ids }
    }
    case 'split': {
      const id = asString(op.id)
      const frame = asNumber(op.frame)
      if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
      requireItem(id)
      const result = splitItem(id, frame)
      if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
      return { leftId: result.leftItem.id, rightId: result.rightItem.id }
    }
    case 'trimStart': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
      requireItem(id)
      trimItemStart(id, amount)
      return { id }
    }
    case 'trimEnd': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
      requireItem(id)
      trimItemEnd(id, amount)
      return { id }
    }
    case 'addTransition': {
      const left = asString(op.leftClipId)
      const right = asString(op.rightClipId)
      if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
      requireItem(left, 'leftClipId')
      requireItem(right, 'rightClipId')
      const added = addTransition(
        left,
        right,
        asString(op.type) as Parameters<typeof addTransition>[2],
        asNumber(op.durationInFrames),
        asString(op.presentation) as Parameters<typeof addTransition>[4],
        asString(op.direction) as Parameters<typeof addTransition>[5],
        asNumber(op.alignment) ?? 0.5,
      )
      if (!added) throw new Error(`addTransition failed for clips "${left}" and "${right}"`)
      const created = useTransitionsStore
        .getState()
        .transitions.filter((t) => t.leftClipId === left && t.rightClipId === right)
        .at(-1)
      if (created && (op.timing !== undefined || op.properties !== undefined)) {
        updateTransition(created.id, {
          ...(op.timing !== undefined
            ? { timing: asString(op.timing) as Transition['timing'] }
            : {}),
          ...(op.properties !== undefined
            ? { properties: op.properties as Transition['properties'] }
            : {}),
        })
      }
      return { added, id: created?.id, presentation: created?.presentation }
    }
    case 'updateTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('updateTransition requires `id`')
      requireTransition(id)
      const updates: Parameters<typeof updateTransition>[1] = {
        ...(op.durationInFrames !== undefined
          ? { durationInFrames: asNumber(op.durationInFrames) }
          : {}),
        ...(op.presentation !== undefined
          ? { presentation: asString(op.presentation) as Transition['presentation'] }
          : {}),
        ...(op.direction !== undefined
          ? { direction: asString(op.direction) as Transition['direction'] }
          : {}),
        ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
        ...(op.alignment !== undefined ? { alignment: asNumber(op.alignment) } : {}),
        ...(op.properties !== undefined
          ? { properties: op.properties as Transition['properties'] }
          : {}),
      }
      if (Object.keys(updates).length === 0)
        throw new Error('updateTransition requires at least one field to change')
      updateTransition(id, updates)
      // The store action validates handles for duration/alignment and, when the
      // requested value doesn't fit, logs a warning and leaves the transition
      // untouched — it returns void, so the rejection is invisible from here.
      // Verify against the resulting state so a rejected edit fails loudly
      // instead of reporting ok with the old value still in place.
      assertTransitionUpdateApplied(id, updates)
      return { id }
    }
    case 'removeTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('removeTransition requires `id`')
      requireTransition(id)
      removeTransition(id)
      return { id }
    }
    case 'addTrack': {
      const kind = op.kind === 'audio' ? 'audio' : 'video'
      const all = tracks()
      const orders = all.map((t) => t.order)
      const order =
        asNumber(op.order) ??
        (kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1)
      const track = createClassicTrack({ tracks: all, kind, order })
      setTracks([...all, track])
      return { trackId: track.id, name: track.name }
    }
    case 'addClip': {
      const mediaId = asString(op.mediaId)
      if (!mediaId) throw new Error('addClip requires `mediaId`')
      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (!media) {
        throw new Error(
          `addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`,
        )
      }
      const from = asNumber(op.from, 0)!
      const projectFps = useTimelineSettingsStore.getState().fps || 30
      const created: Array<{ id: string; type: string }> = []
      const label = media.fileName ?? mediaId

      if (media.mimeType.startsWith('image/')) {
        const item: ImageItem = {
          id: newId(),
          type: 'image',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames: asNumber(op.durationInFrames, 150)!,
          label,
          mediaId,
          src: '',
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
        }
        addItem(item)
        created.push({ id: item.id, type: 'image' })
      } else if (media.mimeType.startsWith('audio/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const item: AudioItem = {
          id: newId(),
          type: 'audio',
          trackId: resolveOrCreateTrack(op.trackId, 'audio'),
          from,
          durationInFrames:
            asNumber(op.durationInFrames) ??
            Math.max(1, Math.round((media.duration ?? 0) * projectFps)),
          label,
          mediaId,
          src: '',
          volume: 0,
          ...sf,
        }
        addItem(item)
        created.push({ id: item.id, type: 'audio' })
      } else if (media.mimeType.startsWith('video/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const durationInFrames =
          asNumber(op.durationInFrames) ??
          Math.max(1, Math.round((media.duration ?? 0) * projectFps))
        const linkedGroupId = crypto.randomUUID()
        const video: VideoItem = {
          id: newId(),
          type: 'video',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames,
          label,
          mediaId,
          src: '',
          volume: 0,
          linkedGroupId,
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
          ...sf,
        }
        addItem(video)
        created.push({ id: video.id, type: 'video' })
        // Linked audio companion (as the app creates on import) so audio renders.
        if (media.audioCodec) {
          const audio: AudioItem = {
            id: newId(),
            type: 'audio',
            trackId: getOrCreateTrack('audio'),
            from,
            durationInFrames,
            label: `${label} audio`,
            mediaId,
            src: '',
            volume: 0,
            linkedGroupId,
            ...sf,
          }
          addItem(audio)
          created.push({ id: audio.id, type: 'audio' })
        }
      } else {
        throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
      }
      return { created }
    }
    case 'addKeyframe': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      const frame = asNumber(op.frame)
      const value = asNumber(op.value)
      if (!itemId || !property || frame === undefined || value === undefined) {
        throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
      }
      requireItem(itemId, 'itemId')
      const easing = asString(op.easing) as EasingType | undefined
      // easingConfig (e.g. custom spring tension/friction/mass) goes through the
      // batch action — the scalar addKeyframe action does not accept it.
      const keyframeId = op.easingConfig
        ? (addKeyframes([
            {
              itemId,
              property: property as AnimatableProperty,
              frame,
              value,
              easing,
              easingConfig: op.easingConfig as Parameters<
                typeof addKeyframes
              >[0][number]['easingConfig'],
            },
          ])[0] ?? '')
        : addKeyframe(itemId, property as AnimatableProperty, frame, value, easing)
      if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
      return { keyframeId }
    }
    case 'setTransformParent': {
      const id = asString(op.id)
      if (!id) throw new Error('setTransformParent requires `id`')
      const child = requireItem(id)
      const detach = op.parentItemId === null
      const parentItemId = detach ? undefined : asString(op.parentItemId)
      if (!detach && !parentItemId) {
        throw new Error(
          'setTransformParent requires `parentItemId` (item id to attach, null to detach)',
        )
      }
      if (parentItemId) requireItem(parentItemId, 'parentItemId')
      const ok = setTransformParent({
        childItemId: id,
        ...(parentItemId ? { parentItemId } : {}),
        behavior: asString(op.behavior) as Parameters<typeof setTransformParent>[0]['behavior'],
        frame: asNumber(op.frame) ?? child.from,
        canvas: editCanvas,
      })
      if (!ok) {
        throw new Error(
          `setTransformParent failed for "${id}"${parentItemId ? ` -> "${parentItemId}"` : ' (detach)'}`,
        )
      }
      return { id, parentItemId: parentItemId ?? null }
    }
    case 'removeKeyframes': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
      requireItem(itemId, 'itemId')
      removeKeyframesForProperty(itemId, property as AnimatableProperty)
      return { itemId, property }
    }
    case 'addEffect': {
      const itemId = asString(op.itemId)
      if (!itemId) throw new Error('addEffect requires `itemId`')
      requireItem(itemId, 'itemId')
      const effect =
        op.effect && typeof op.effect === 'object'
          ? op.effect
          : op.gpuEffectType
            ? { type: 'gpu-effect', gpuEffectType: op.gpuEffectType, params: op.params ?? {} }
            : null
      if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
      const gpuEffectType = (effect as { gpuEffectType?: unknown }).gpuEffectType
      if (typeof gpuEffectType !== 'string' || !getGpuEffect(gpuEffectType)) {
        throw new Error(`gpuEffectType: unknown GPU effect "${String(gpuEffectType)}"`)
      }
      addEffect(itemId, effect as VisualEffect)
      return { itemId }
    }
    case 'removeEffect': {
      const itemId = asString(op.itemId)
      const effectId = asString(op.effectId)
      if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
      const item = requireItem(itemId, 'itemId')
      if (!item.effects?.some((candidate) => candidate.id === effectId)) {
        throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
      }
      removeEffect(itemId, effectId)
      return { itemId, effectId }
    }
    case 'setTransform': {
      const id = asString(op.id)
      if (!id || !op.transform || typeof op.transform !== 'object') {
        throw new Error('setTransform requires `id` and `transform`')
      }
      requireItem(id)
      updateItemTransform(id, op.transform as Partial<TransformProperties>)
      return { id }
    }
    default:
      throw new Error(`Unknown edit op: ${String(op.op)}`)
  }
}

/** Apply one op, record its result (success or failure), and rethrow on failure. */
function applyOpTracked(
  rawOp: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
  results: HeadlessEditResult['results'],
): void {
  const callerId = asString(rawOp.callerId)
  const op = resolveOperationRefs(rawOp, prior)
  try {
    const detail = applyOp(op)
    const result = { ...(callerId ? { callerId } : {}), op: op.op, ok: true as const, detail }
    results.push(result)
    if (callerId) prior.set(callerId, result)
  } catch (error) {
    results.push({
      ...(callerId ? { callerId } : {}),
      op: op.op,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Edit op "${op.op}" failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function editProject(input: HeadlessEditInput): Promise<HeadlessEditResult> {
  const { project: migrated } = migrateProject(input.project)
  editCanvas = {
    width: migrated.metadata?.width ?? 1920,
    height: migrated.metadata?.height ?? 1080,
    fps: migrated.metadata?.fps ?? 30,
  }
  await hydrateTimelineStoresFromProject(migrated)
  seedMediaLibrary(input.media)

  log.info('Headless edit starting', { ops: input.ops.length })

  const results: HeadlessEditResult['results'] = []
  const prior = new Map<string, HeadlessEditResult['results'][number]>()
  const callerIds = input.ops.map((op) => asString(op.callerId)).filter(Boolean) as string[]
  if (new Set(callerIds).size !== callerIds.length) throw new Error('Duplicate edit callerId')
  for (const rawOp of input.ops) applyOpTracked(rawOp, prior, results)

  const timeline = buildTimelineFromStores()
  log.info('Headless edit complete', { applied: results.length })

  return {
    ok: true,
    project: { ...migrated, timeline },
    applied: results.length,
    results,
  }
}

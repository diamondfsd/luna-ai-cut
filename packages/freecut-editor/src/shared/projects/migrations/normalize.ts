/**
 * Normalization Utilities
 *
 * Applied on every project load to ensure data conforms to current defaults.
 * Unlike migrations, normalization is not versioned - it always applies
 * the current expected defaults and constraints.
 *
 * Use normalization for:
 * - Applying default values for missing optional fields
 * - Clamping values to valid ranges
 * - Ensuring type consistency
 *
 * Use migrations for:
 * - Breaking schema changes
 * - Renaming fields
 * - Restructuring data
 */

import type { Project, ProjectTimeline } from '@freecut/types/project'
import { DEFAULT_TRACK_HEIGHT, DEFAULT_FPS } from '@freecut/shared/timeline/defaults'
import { normalizeAudioEqSettings } from '@freecut/shared/utils/audio-eq'
import { applyOptionalClamps } from '@freecut/shared/timeline/item-clamps'
import { sanitizeTextMotion } from './sanitize-text-motion'
import type { ProjectWarning } from './types'
import { repairOverlappingItems, repairUniformLinkedOffsets } from './track-integrity'

/**
 * Normalize a track to ensure all fields have valid values.
 */
function normalizeTrack(
  track: ProjectTimeline['tracks'][number],
  index: number,
): ProjectTimeline['tracks'][number] {
  const normalizedVolume = track.volume
  const normalizedKind = track.kind === 'video' || track.kind === 'audio' ? track.kind : undefined
  return {
    ...track,
    // Track height is a local view preference, persisted to localStorage and
    // re-derived by items-store.setTracks() on load. The field is kept at the
    // default so project files stay stable; its stored value is never read.
    height: DEFAULT_TRACK_HEIGHT,
    // Ensure boolean fields have defaults
    locked: track.locked ?? false,
    syncLock: track.syncLock ?? true,
    visible: track.visible ?? true,
    muted: track.muted ?? false,
    solo: track.solo ?? false,
    volume: normalizedVolume === undefined ? 0 : Math.max(-60, Math.min(12, normalizedVolume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
    kind: normalizedKind,
    // Ensure order is set (fallback to index if missing)
    order: track.order ?? index,
  }
}

/**
 * Normalize a timeline item to ensure all fields have valid values.
 */
function normalizeItem(
  item: ProjectTimeline['items'][number],
  warnings?: ProjectWarning[],
  compositionId?: string,
): ProjectTimeline['items'][number] {
  const normalized = { ...item }

  // Keep timeline coordinates aligned to whole frames.
  normalized.from = Math.max(0, Math.round(normalized.from ?? 0))
  normalized.durationInFrames = Math.max(1, Math.round(normalized.durationInFrames ?? 1))

  // A shape item without `shapeType` passes schema validation (the field is
  // optional there) but the renderer draws nothing — report it loudly instead
  // of letting the element vanish from the frame.
  if (normalized.type === 'shape' && !(normalized as { shapeType?: unknown }).shapeType) {
    warnings?.push({
      code: 'SHAPE_MISSING_TYPE',
      message: `Shape item "${normalized.id}" has no "shapeType" (e.g. 'rectangle') and will not render`,
      itemIds: [normalized.id],
      trackId: normalized.trackId,
      compositionId,
    })
  }

  // Frame/audio/EQ optional-field clamps — shared with the runtime items-store
  // normalizer so adding a new clamped field only needs registering once.
  applyOptionalClamps(normalized as Record<string, unknown>)

  // Motion-text spec: drop malformed slots and clamp numerics on every load.
  if (normalized.textMotion !== undefined) {
    normalized.textMotion = sanitizeTextMotion(normalized.textMotion)
  }

  // Ensure speed is valid (default 1.0, range 0.1-10.0)
  if (normalized.speed !== undefined) {
    normalized.speed = Math.max(0.1, Math.min(10.0, normalized.speed))
  }

  // Ensure volume is valid (default 0dB, range -60 to +12)
  if (normalized.volume !== undefined) {
    normalized.volume = Math.max(-60, Math.min(12, normalized.volume))
  }

  // Ensure fade values are non-negative
  if (normalized.fadeIn !== undefined) {
    normalized.fadeIn = Math.max(0, normalized.fadeIn)
  }
  if (normalized.fadeOut !== undefined) {
    normalized.fadeOut = Math.max(0, normalized.fadeOut)
  }
  if (normalized.audioFadeIn !== undefined) {
    normalized.audioFadeIn = Math.max(0, normalized.audioFadeIn)
  }
  if (normalized.audioFadeOut !== undefined) {
    normalized.audioFadeOut = Math.max(0, normalized.audioFadeOut)
  }

  // Normalize transform if present
  if (normalized.transform) {
    normalized.transform = {
      ...normalized.transform,
      // Ensure rotation is normalized to 0-360
      rotation:
        normalized.transform.rotation !== undefined
          ? ((normalized.transform.rotation % 360) + 360) % 360
          : undefined,
      anchorX: normalized.transform.anchorX,
      anchorY: normalized.transform.anchorY,
      flipHorizontal:
        normalized.transform.flipHorizontal !== undefined
          ? !!normalized.transform.flipHorizontal
          : undefined,
      flipVertical:
        normalized.transform.flipVertical !== undefined
          ? !!normalized.transform.flipVertical
          : undefined,
      // Ensure opacity is 0-1
      opacity:
        normalized.transform.opacity !== undefined
          ? Math.max(0, Math.min(1, normalized.transform.opacity))
          : undefined,
      // Ensure cornerRadius is non-negative
      cornerRadius:
        normalized.transform.cornerRadius !== undefined
          ? Math.max(0, normalized.transform.cornerRadius)
          : undefined,
    }
  }

  return normalized
}

/**
 * Normalize a transition to ensure all fields have valid values.
 */
function normalizeTransition(
  transition: NonNullable<ProjectTimeline['transitions']>[number],
): NonNullable<ProjectTimeline['transitions']>[number] {
  const timing =
    (transition.timing as string | undefined) === 'spring' ? 'linear' : transition.timing

  return {
    ...transition,
    // Ensure duration is at least 1 frame
    durationInFrames: Math.max(1, Math.round(transition.durationInFrames)),
    timing: timing ?? 'linear',
  }
}

function flattenTrackGroups(tracks: ProjectTimeline['tracks']): ProjectTimeline['tracks'] {
  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => ({
      ...track,
      parentTrackId: undefined,
      isGroup: undefined,
      isCollapsed: undefined,
    }))
    .sort((a, b) => a.order - b.order)
}

/**
 * Normalize a timeline to ensure all data conforms to current defaults.
 */
function normalizeTimeline(
  timeline: ProjectTimeline,
  warnings?: ProjectWarning[],
): ProjectTimeline {
  const normalizedTracks = flattenTrackGroups(
    timeline.tracks.map((track, index) => normalizeTrack(track, index)),
  )

  const normalizedItems = timeline.items.map((item) => normalizeItem(item, warnings))
  const alignedItems = repairUniformLinkedOffsets(normalizedItems)
  const normalizedTransitions = timeline.transitions?.map(normalizeTransition)

  // Drop tab ids that don't resolve to a composition (and any duplicates), so
  // standalone-timeline tabs never dangle after a composition is deleted.
  const validSequenceIds = new Set(
    (timeline.compositions ?? [])
      .filter((comp) => comp.editorKind !== 'composite-2d')
      .map((comp) => comp.id),
  )
  const normalizedTopLevelSequenceIds = timeline.topLevelSequenceIds
    ? [...new Set(timeline.topLevelSequenceIds.filter((id) => validSequenceIds.has(id)))]
    : undefined

  return {
    ...timeline,
    topLevelSequenceIds: normalizedTopLevelSequenceIds,
    // Normalize tracks
    tracks: normalizedTracks,
    busAudioEq: normalizeAudioEqSettings(timeline.busAudioEq),
    // Normalize items and repair overlaps
    items: repairOverlappingItems(alignedItems, normalizedTransitions, warnings),
    // Normalize transitions if present
    transitions: normalizedTransitions,
    // Normalize sub-composition tracks and items
    compositions: timeline.compositions?.map((comp) => {
      const compItems = comp.items.map((item) => normalizeItem(item, warnings, comp.id))
      const compTransitions = comp.transitions?.map(normalizeTransition)
      const compTracks = flattenTrackGroups(
        comp.tracks.map((track, index) => normalizeTrack(track, index)),
      )
      const alignedCompositionItems = repairUniformLinkedOffsets(compItems)
      return {
        ...comp,
        editorKind: comp.editorKind === 'composite-2d' ? 'composite-2d' : 'sequence',
        tracks: compTracks,
        busAudioEq: normalizeAudioEqSettings(comp.busAudioEq),
        items: repairOverlappingItems(alignedCompositionItems, compTransitions, warnings, comp.id),
        transitions: compTransitions,
      }
    }),
    // Ensure frame values are non-negative integers
    currentFrame: Math.max(0, Math.floor(timeline.currentFrame ?? 0)),
    // Ensure zoom is positive
    zoomLevel: Math.max(0.01, timeline.zoomLevel ?? 1),
    // Ensure scroll is non-negative
    scrollPosition: Math.max(0, timeline.scrollPosition ?? 0),
  }
}

/**
 * Normalize project metadata.
 */
function normalizeMetadata(metadata: Project['metadata']): Project['metadata'] {
  return {
    ...metadata,
    // Ensure dimensions are positive
    width: Math.max(1, metadata.width),
    height: Math.max(1, metadata.height),
    // Ensure FPS is valid
    fps: Math.max(1, Math.min(120, metadata.fps ?? DEFAULT_FPS)),
  }
}

/**
 * Normalize a project to ensure all data conforms to current defaults.
 * This is applied after migrations on every load.
 */
export function normalizeProject(project: Project, warnings?: ProjectWarning[]): Project {
  const normalized: Project = {
    ...project,
    // Normalize metadata
    metadata: normalizeMetadata(project.metadata),
  }

  // Normalize timeline if present
  if (normalized.timeline) {
    normalized.timeline = normalizeTimeline(normalized.timeline, warnings)
  }

  return normalized
}

/**
 * Check if normalization changed the project.
 * Uses JSON comparison for simplicity (works for our data types).
 */
export function didNormalizationChange(original: Project, normalized: Project): boolean {
  return JSON.stringify(original) !== JSON.stringify(normalized)
}

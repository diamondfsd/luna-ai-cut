/**
 * Transition Actions - cut-centered handle-based transitions.
 *
 * Transitions stay attached to the cut between adjacent clips. When two finite
 * source clips have no spare handles, adding a transition creates a real
 * overlap by moving the incoming clip and its linked companions together.
 */

import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@freecut/types/transition'
import { TRANSITION_CONFIGS } from '@freecut/types/transition'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  canAddTransition,
  areFramesAligned,
  getMaxTransitionDurationForHandles,
  shouldUseOverlapTransitionFallback,
} from '../../utils/transition-utils'
import { getLinkedAndAttachedItemIds } from '../../utils/linked-items'
import { applyTransitionRepairs, execute, getLogger } from './shared'

export function addTransition(
  leftClipId: string,
  rightClipId: string,
  type: TransitionType = 'crossfade',
  durationInFrames?: number,
  presentation?: TransitionPresentation,
  direction?: WipeDirection | SlideDirection | FlipDirection,
  alignment: number = 0.5,
): boolean {
  return execute(
    'ADD_TRANSITION',
    () => {
      const items = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      // Find the clips
      const leftClip = items.find((i) => i.id === leftClipId)
      const rightClip = items.find((i) => i.id === rightClipId)

      if (!leftClip || !rightClip) {
        getLogger().warn('[addTransition] Clips not found')
        return false
      }

      const maxByClipDuration = Math.floor(
        Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1,
      )
      if (maxByClipDuration < 1) {
        getLogger().warn('[addTransition] Cannot add transition: clips are too short')
        return false
      }

      const config = TRANSITION_CONFIGS[type]
      const requestedDuration = durationInFrames ?? config.defaultDuration
      let duration = Math.max(1, Math.min(Math.round(requestedDuration), maxByClipDuration))

      // Check this before moving anything so a duplicate transition cannot
      // alter clip geometry.
      const existingTransition = transitions.find(
        (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId,
      )
      if (existingTransition) {
        getLogger().warn('[addTransition] Transition already exists between these clips')
        return false
      }

      const leftEnd = leftClip.from + leftClip.durationInFrames
      const isAdjacent = areFramesAligned(leftEnd, rightClip.from)
      const timelineFps = useTimelineSettingsStore.getState().fps
      const usesOverlapFallback =
        isAdjacent &&
        shouldUseOverlapTransitionFallback(leftClip, rightClip, timelineFps)
      if (isAdjacent) {
        const maxHandleDuration = getMaxTransitionDurationForHandles(
          leftClip,
          rightClip,
          alignment,
          timelineFps,
        )
        if (maxHandleDuration < 1 && !usesOverlapFallback) {
          getLogger().warn(
            '[addTransition] Cannot add transition: insufficient source handle at cut',
          )
          return false
        }
        if (!usesOverlapFallback) {
          duration = Math.min(duration, maxHandleDuration)
        }
      }

      // Validate the final geometry. For the fallback path, validate against
      // the overlap that will be created before mutating the store.
      const positionedRightClip = usesOverlapFallback
        ? { ...rightClip, from: rightClip.from - duration }
        : rightClip
      const validation = canAddTransition(
        leftClip,
        positionedRightClip,
        duration,
        alignment,
        timelineFps,
      )
      if (!validation.canAdd) {
        getLogger().warn('[addTransition] Cannot add transition:', validation.reason)
        return false
      }

      let overlapAffectedIds: string[] = []
      if (usesOverlapFallback) {
        const movedIdSet = new Set(getLinkedAndAttachedItemIds(items, rightClip.id))
        const touchedTrackIds = new Set(
          items
            .filter((item) => movedIdSet.has(item.id))
            .map((item) => item.trackId),
        )
        const originalRightEnd = rightClip.from + rightClip.durationInFrames
        const moveUpdates = new Map<string, { id: string; from: number }>()

        // Creating overlap shortens the sequence by `duration`. Ripple the
        // following clips on the touched tracks so adding a transition does
        // not leave a gap after the incoming clip. Linked companions of each
        // downstream clip follow it across their own tracks.
        for (const item of items) {
          if (
            !movedIdSet.has(item.id) &&
            touchedTrackIds.has(item.trackId) &&
            item.from >= originalRightEnd
          ) {
            for (const linkedId of getLinkedAndAttachedItemIds(items, item.id)) {
              if (moveUpdates.has(linkedId)) continue
              const linkedItem = items.find((candidate) => candidate.id === linkedId)
              if (linkedItem) {
                moveUpdates.set(linkedId, {
                  id: linkedId,
                  from: linkedItem.from - duration,
                })
              }
            }
          }
        }

        useItemsStore.getState()._moveItems(
          [
            ...items
              .filter((item) => movedIdSet.has(item.id))
              .map((item) => ({ id: item.id, from: item.from - duration })),
            ...moveUpdates.values(),
          ],
        )
        overlapAffectedIds = [
          ...new Set([leftClip.id, ...movedIdSet, ...moveUpdates.keys()]),
        ]
      }

      // Create transition record
      useTransitionsStore
        .getState()
        ._addTransition(
          leftClipId,
          rightClipId,
          leftClip.trackId,
          type,
          duration,
          presentation,
          direction,
          alignment,
        )

      if (overlapAffectedIds.length > 0) {
        applyTransitionRepairs(overlapAffectedIds)
      }

      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { leftClipId, rightClipId, type },
  )
}

type TransitionUpdates = Partial<
  Pick<
    Transition,
    | 'durationInFrames'
    | 'type'
    | 'presentation'
    | 'direction'
    | 'timing'
    | 'alignment'
    | 'bezierPoints'
    | 'presetId'
    | 'properties'
  >
>

function _validateAndUpdateTransition(id: string, updates: TransitionUpdates): boolean {
  const transitions = useTransitionsStore.getState().transitions
  const transition = transitions.find((t) => t.id === id)
  if (!transition) return false
  const items = useItemsStore.getState().items
  const leftClip = items.find((i) => i.id === transition.leftClipId)
  const rightClip = items.find((i) => i.id === transition.rightClipId)
  const nextTransition = { ...transition, ...updates }

  if (leftClip && rightClip) {
    const validation = canAddTransition(
      leftClip,
      rightClip,
      nextTransition.durationInFrames,
      nextTransition.alignment,
      useTimelineSettingsStore.getState().fps,
    )
    if (!validation.canAdd) {
      getLogger().warn('[updateTransition] Cannot update transition:', validation.reason)
      return false
    }
  }

  useTransitionsStore.getState()._updateTransition(id, updates)
  return true
}

export function updateTransition(id: string, updates: TransitionUpdates): void {
  execute(
    'UPDATE_TRANSITION',
    () => {
      if (_validateAndUpdateTransition(id, updates)) {
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { id, updates },
  )
}

export function updateTransitions(
  updates: Array<{
    id: string
    updates: TransitionUpdates
  }>,
): void {
  if (updates.length === 0) return
  execute(
    'UPDATE_TRANSITIONS',
    () => {
      let didChange = false
      for (const { id, updates: u } of updates) {
        if (u.durationInFrames !== undefined || u.alignment !== undefined) {
          // Alignment / duration changes need handle validation just like single updates.
          // Re-read the store on each iteration so duplicate ids see fresh state.
          const transition = useTransitionsStore.getState().transitions.find((t) => t.id === id)
          if (
            transition &&
            ((u.durationInFrames !== undefined &&
              u.durationInFrames !== transition.durationInFrames) ||
              (u.alignment !== undefined && u.alignment !== transition.alignment))
          ) {
            if (_validateAndUpdateTransition(id, u)) didChange = true
            continue
          }
        }
        useTransitionsStore.getState()._updateTransition(id, u)
        didChange = true
      }
      if (didChange) {
        useTimelineSettingsStore.getState().markDirty()
      }
    },
    { updates },
  )
}

export function removeTransition(id: string): void {
  execute(
    'REMOVE_TRANSITION',
    () => {
      useTransitionsStore.getState()._removeTransition(id)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id },
  )
}

import { registerMediaRelinkingTimelineActions } from '../stores/media-relinking-timeline-actions'
import { useTimelineSettingsStore } from '@freecut/features/timeline/stores/timeline-settings-store'
import { useItemsStore } from '@freecut/features/timeline/stores/items-store'
import { useTransitionsStore } from '@freecut/features/timeline/stores/transitions-store'
import { useKeyframesStore } from '@freecut/features/timeline/stores/keyframes-store'
import { getSynchronizedLinkedItems } from '@freecut/features/timeline/utils/linked-items'
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  openComposition,
  openCompositionAsTab,
  removeProjectItems,
  renameCompoundClip,
  updateProjectItem,
} from '@freecut/features/timeline/stores/timeline-actions'
import { execute } from '@freecut/features/timeline/stores/actions/shared'

const unregisterMediaRelinkingTimelineActions = registerMediaRelinkingTimelineActions({
  removeProjectItems,
  updateProjectItem,
  getItemsState: () => {
    const { items, itemById } = useItemsStore.getState()
    return { items, itemById }
  },
  getFps: () => useTimelineSettingsStore.getState().fps,
  getSynchronizedLinkedItems,
})

if (import.meta.hot) {
  import.meta.hot.dispose(unregisterMediaRelinkingTimelineActions)
}

function removeTimelineItemsExact(ids: string[]): void {
  const existingIds = ids.filter((id) => useItemsStore.getState().itemById[id] !== undefined)
  if (existingIds.length === 0) return

  execute(
    'REMOVE_ITEMS',
    () => {
      useItemsStore.getState()._removeItems(existingIds)
      useTransitionsStore.getState()._removeTransitionsForItems(existingIds)
      useKeyframesStore.getState()._removeKeyframesForItems(existingIds)
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: existingIds, exact: true },
  )
}

export {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  openComposition,
  openCompositionAsTab,
  removeTimelineItemsExact,
  removeProjectItems,
  renameCompoundClip,
}

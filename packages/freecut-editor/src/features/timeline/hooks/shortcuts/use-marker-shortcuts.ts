/**
 * Marker shortcuts: M (add), Shift+M (remove), [ ] (navigate).
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useMarkersStore } from '../../stores/markers-store'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { HOTKEY_OPTIONS } from '@freecut/config/hotkeys'
import { addMarker, removeMarker } from '../../stores/actions/marker-actions'
import { useResolvedHotkeys } from '@freecut/features/timeline/deps/settings'

export function useMarkerShortcuts() {
  const hotkeys = useResolvedHotkeys()
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  // Markers: M - Add marker at playhead
  useHotkeys(
    hotkeys.ADD_MARKER,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      addMarker(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  // Markers: Shift+M - Remove selected marker
  useHotkeys(
    hotkeys.REMOVE_MARKER,
    (event) => {
      event.preventDefault()
      const id = useSelectionStore.getState().selectedMarkerId
      if (id) {
        removeMarker(id)
        clearSelection()
      }
    },
    HOTKEY_OPTIONS,
    [clearSelection],
  )

  // Markers: [ - Jump to previous marker
  useHotkeys(
    hotkeys.PREVIOUS_MARKER,
    (event) => {
      event.preventDefault()
      const currentMarkers = useMarkersStore.getState().markers
      if (currentMarkers.length === 0) return
      const currentFrame = usePlaybackStore.getState().currentFrame
      let previousFrame: number | undefined
      for (const marker of currentMarkers) {
        if (marker.frame < currentFrame) {
          if (previousFrame === undefined || marker.frame > previousFrame) {
            previousFrame = marker.frame
          }
        }
      }
      if (previousFrame !== undefined) {
        setCurrentFrame(previousFrame)
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame],
  )

  // Markers: ] - Jump to next marker
  useHotkeys(
    hotkeys.NEXT_MARKER,
    (event) => {
      event.preventDefault()
      const currentMarkers = useMarkersStore.getState().markers
      if (currentMarkers.length === 0) return
      const currentFrame = usePlaybackStore.getState().currentFrame
      let nextFrame: number | undefined
      for (const marker of currentMarkers) {
        if (marker.frame > currentFrame) {
          if (nextFrame === undefined || marker.frame < nextFrame) {
            nextFrame = marker.frame
          }
        }
      }
      if (nextFrame !== undefined) {
        setCurrentFrame(nextFrame)
      }
    },
    HOTKEY_OPTIONS,
    [setCurrentFrame],
  )
}

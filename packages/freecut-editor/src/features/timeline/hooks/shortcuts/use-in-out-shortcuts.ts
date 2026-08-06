/**
 * Timeline in/out shortcuts: I, O, Shift+I/O, Alt+X.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@freecut/config/hotkeys'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useTimelineStore } from '../../stores/timeline-store'
import { useResolvedHotkeys } from '@freecut/features/timeline/deps/settings'

function addShiftModifier(binding: string): string {
  const parts = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.some((part) => part.toLowerCase() === 'shift')) {
    return binding
  }

  const key = parts.pop()
  if (!key) return `shift+${binding}`
  return [...parts, 'shift', key].join('+')
}

export function useInOutShortcuts() {
  const hotkeys = useResolvedHotkeys()
  const markInAtPreview = addShiftModifier(hotkeys.MARK_IN)
  const markOutAtPreview = addShiftModifier(hotkeys.MARK_OUT)

  useHotkeys(
    hotkeys.MARK_IN,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markInAtPreview,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markInAtPreview],
  )

  useHotkeys(
    hotkeys.MARK_OUT,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markOutAtPreview,
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markOutAtPreview],
  )

  useHotkeys(
    hotkeys.CLEAR_IN_OUT,
    (event) => {
      event.preventDefault()
      useTimelineStore.getState().clearInOutPoints()
    },
    HOTKEY_OPTIONS,
    [],
  )
}

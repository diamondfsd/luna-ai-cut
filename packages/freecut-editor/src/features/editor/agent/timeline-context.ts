/**
 * Read-only timeline snapshot for the agent prompt. Includes a grounded clip
 * inventory with refs ("c1", "c2", …) so the model can target specific clips
 * instead of guessing — the single biggest lever on tool-call accuracy for a
 * small local model. Building the inventory also refreshes the ref→id map the
 * tools resolve against, keeping prompt and execution in sync.
 */

import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { buildClipRefs } from './tools'

function formatSeconds(value: number): string {
  return value.toFixed(1)
}

export interface TimelineContextSnapshot {
  text: string
  fps: number
  selectedCount: number
  clipCount: number
}

export function buildTimelineContext(): TimelineContextSnapshot {
  const { items, fps } = useTimelineStore.getState()
  const { currentFrame } = usePlaybackStore.getState()
  const { selectedItemIds } = useSelectionStore.getState()
  const safeFps = Math.max(1, fps)

  const clips = buildClipRefs()
  const maxEnd = items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)

  const lines = [
    `Project: ${formatSeconds(maxEnd / safeFps)}s long at ${fps}fps. Playhead at ${formatSeconds(currentFrame / safeFps)}s.`,
  ]

  if (clips.length === 0) {
    lines.push('Clips: none.')
  } else {
    lines.push('Clips (ref · type · label · start–end · [selected]):')
    for (const clip of clips) {
      lines.push(
        `  ${clip.ref} ${clip.type} "${clip.label}" ${formatSeconds(clip.startSeconds)}–${formatSeconds(clip.endSeconds)}s${clip.selected ? ' [selected]' : ''}`,
      )
    }
    if (items.length > clips.length) {
      lines.push(`  …and ${items.length - clips.length} more clips not listed.`)
    }
  }

  return {
    text: lines.join('\n'),
    fps,
    selectedCount: selectedItemIds.length,
    clipCount: clips.length,
  }
}

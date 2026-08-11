// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@freecut/types/timeline'
import { shouldAutoInsertTranscriptCaptions } from './use-auto-transcript-captions'

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    mediaId: 'media-1',
    trackId: 'track-1',
    label: 'Clip',
    from: 0,
    durationInFrames: 30,
    ...overrides,
  } as TimelineItem
}

function isEligible(item: TimelineItem): boolean {
  return shouldAutoInsertTranscriptCaptions({
    item,
    caption: {
      canManageCaptions: true,
      mediaHasTranscript: true,
    } as never,
    hasTimelineCaptions: false,
    isBroken: false,
  })
}

describe('automatic transcript captions', () => {
  it('keeps normal timeline clips eligible', () => {
    expect(isEligible(videoItem())).toBe(true)
  })

  it('does not mutate source-managed clips after an AI publication', () => {
    expect(isEligible(videoItem({
      aiEditingSource: {
        projectId: 'project-1',
        ref: 'opening-shot',
        role: 'primary',
      },
    }))).toBe(false)
  })
})

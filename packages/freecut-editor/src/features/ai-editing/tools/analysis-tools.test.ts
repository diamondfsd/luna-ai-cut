// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { paginateTranscriptEntries } from './analysis-tools'

describe('transcript result pagination', () => {
  it('returns 27 ordinary transcript segments in one page', () => {
    const entries = Array.from({ length: 27 }, (_, index) => ({
      mediaRef: 'media:one',
      startSeconds: index,
      endSeconds: index + 1,
      text: `第 ${index + 1} 段口播内容`,
    }))

    expect(paginateTranscriptEntries(entries)).toEqual({
      segments: entries,
      nextCursor: null,
    })
  })
})

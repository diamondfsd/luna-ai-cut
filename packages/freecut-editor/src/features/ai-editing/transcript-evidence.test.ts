import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscript } from '@freecut/types/storage'
import {
  buildTranscriptExcerpt,
  countTranscriptTextUnits,
  normalizeTranscriptSearchText,
} from './transcript-evidence'

function transcript(): MediaTranscript {
  return {
    mediaId: 'media-1',
    model: 'parakeet-tdt-v3',
    quantization: 'hybrid',
    language: 'zh',
    createdAt: 1,
    segments: [
      { start: 1, end: 3, text: '我想要 字母变成彩虹色' },
      { start: 4, end: 5, text: '先放一块，再放一块。' },
    ],
  } as MediaTranscript
}

describe('transcript evidence', () => {
  it('treats segment text as usable speech when word timestamps are unavailable', () => {
    expect(countTranscriptTextUnits(transcript())).toBeGreaterThan(0)
  })

  it('preserves time-addressable text for the editing assistant', () => {
    expect(buildTranscriptExcerpt(transcript())).toEqual([
      { startSeconds: 1, endSeconds: 3, text: '我想要 字母变成彩虹色' },
      { startSeconds: 4, endSeconds: 5, text: '先放一块，再放一块。' },
    ])
  })

  it('matches phrases despite punctuation and spacing differences', () => {
    expect(normalizeTranscriptSearchText('AI Agent')).toBe(
      normalizeTranscriptSearchText('ai-agent'),
    )
  })
})

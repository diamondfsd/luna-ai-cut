import { describe, expect, it } from 'vite-plus/test'
import { mediaIdFromToolInput, mediaIdsFromToolInput } from './media-reference'

describe('AI editing media references', () => {
  it('accepts workspace media references and legacy bare IDs', () => {
    expect(mediaIdFromToolInput('media:video-1')).toBe('video-1')
    expect(mediaIdFromToolInput('video-2')).toBe('video-2')
    expect(mediaIdsFromToolInput(['media:video-1', 'video-2'])).toEqual([
      'video-1',
      'video-2',
    ])
  })
})

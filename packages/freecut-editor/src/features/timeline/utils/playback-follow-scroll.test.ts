import { describe, expect, it } from 'vite-plus/test'

import { getPlaybackFollowScrollLeft } from './playback-follow-scroll'

describe('getPlaybackFollowScrollLeft', () => {
  it('leaves the viewport alone while forward playback remains visible', () => {
    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 900,
        scrollLeft: 400,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: 1,
      }),
    ).toBeNull()
  })

  it('pages forward with most of the new viewport available ahead', () => {
    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 1200,
        scrollLeft: 400,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: 1,
      }),
    ).toBe(1040)
  })

  it('pages backward with most of the new viewport available behind', () => {
    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 399,
        scrollLeft: 400,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: -1,
      }),
    ).toBe(0)
  })

  it('follows playback across a loop jump to the opposite side', () => {
    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 100,
        scrollLeft: 1600,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: 1,
      }),
    ).toBe(0)

    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 2950,
        scrollLeft: 0,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: -1,
      }),
    ).toBe(2310)
  })

  it('clamps paging to the scrollable timeline range', () => {
    expect(
      getPlaybackFollowScrollLeft({
        playheadX: 3100,
        scrollLeft: 2000,
        viewportWidth: 800,
        maxScrollLeft: 2400,
        playbackDirection: 1,
      }),
    ).toBe(2400)
  })
})

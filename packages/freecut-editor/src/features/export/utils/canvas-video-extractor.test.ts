import { describe, expect, it, vi } from 'vite-plus/test'
import { VideoFrameExtractor } from './canvas-video-extractor'

describe('VideoFrameExtractor lifecycle', () => {
  it('closes a sample yielded after the extractor was disposed', async () => {
    let resolveNext!: (result: IteratorResult<{ close: () => void }>) => void
    const nextResult = new Promise<IteratorResult<{ close: () => void }>>((resolve) => {
      resolveNext = resolve
    })
    const sample = { close: vi.fn() }
    const iterator = {
      next: vi.fn(() => nextResult),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }

    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      sampleIterator: typeof iterator | null
      peekNextSample: () => Promise<{ close: () => void } | null>
    }
    internals.sampleIterator = iterator

    const pendingSample = internals.peekNextSample()
    extractor.dispose()
    resolveNext({ value: sample, done: false })

    await expect(pendingSample).resolves.toBeNull()
    expect(sample.close).toHaveBeenCalledTimes(1)
    expect(iterator.return).toHaveBeenCalledTimes(1)
  })
})

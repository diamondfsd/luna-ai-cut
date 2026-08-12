// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { ToolResultStore } from './tool-result-store'
import type { AiEditingObservation } from './types'

function observation(toolId: string, value: string): AiEditingObservation {
  return { toolId, result: { ok: true, message: '完成', data: { value } } }
}

describe('ToolResultStore', () => {
  it('keeps small tool results inline', () => {
    const source = observation('media.list', 'small')
    expect(new ToolResultStore().forModel(source)).toEqual({
      id: source.toolId,
      result: source.result,
    })
  })

  it('replaces large results with a stable readable reference', () => {
    const store = new ToolResultStore()
    const source = observation('media.read', 'x'.repeat(10_000))
    const first = store.forModel(source)

    expect(store.forModel(source)).toEqual(first)
    expect(first.result.data).toMatchObject({
      resultId: 'result-1',
      nextOffset: 0,
      readWith: 'result.read',
    })
    expect(JSON.stringify(first)).not.toContain('x'.repeat(1_000))
  })

  it('reads referenced results by character offset until completion', () => {
    const store = new ToolResultStore()
    const reference = store.forModel(observation('media.read', 'x'.repeat(10_000)))
    const resultId = (reference.result.data as { resultId: string }).resultId
    const first = store.read({ resultId, offset: 0, maxChars: 1_000 })
    const nextOffset = (first.data as { nextOffset: number }).nextOffset
    const second = store.read({ resultId, offset: nextOffset, maxChars: 3_000 })

    expect(first.ok).toBe(true)
    expect((first.data as { content: string }).content).toHaveLength(1_000)
    expect(nextOffset).toBe(1_000)
    expect((second.data as { offset: number }).offset).toBe(nextOffset)

    let offset = 0
    let lastNextOffset: number | null = offset
    while (lastNextOffset !== null) {
      const page = store.read({ resultId, offset, maxChars: 3_000 })
      lastNextOffset = (page.data as { nextOffset: number | null }).nextOffset
      if (lastNextOffset !== null) offset = lastNextOffset
    }
    expect(lastNextOffset).toBeNull()
  })

  it('rejects stale references', () => {
    expect(new ToolResultStore().read({ resultId: 'missing' })).toMatchObject({ ok: false })
  })

  it('does not page a result.read page again', () => {
    const store = new ToolResultStore()
    const page = observation('result.read', 'x'.repeat(10_000))
    expect(store.forModel(page)).toEqual({ id: 'result.read', result: page.result })
  })
})

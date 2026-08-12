import { describe, expect, it } from 'vitest'

import { summarizeToolArguments, summarizeToolResult } from './diagnostic-log'

describe('AI editing diagnostic log summaries', () => {
  it('reports source write shape without logging source content or credentials', () => {
    expect(summarizeToolArguments({
      path: 'sequences/main/segments/intro.json',
      content: 'private source body',
      apiKey: 'private-key',
      changes: [{ path: 'sequences/main/track.json', content: 'another body' }],
    })).toEqual({
      path: 'sequences/main/segments/intro.json',
      content: { characters: 19 },
      apiKey: '[redacted]',
      changes: [{ path: 'sequences/main/track.json', content: { characters: 12 } }],
    })
  })

  it('reports result counts without logging returned bodies', () => {
    expect(summarizeToolResult({
      ok: true,
      message: 'done',
      data: {
        content: 'source body',
        entries: [{ path: 'a.json' }, { path: 'b.json' }],
        revision: 'abc',
      },
    })).toEqual({
      ok: true,
      message: 'done',
      data: {
        content: { characters: 11 },
        entries: { items: 2 },
        revision: 'abc',
      },
    })
  })
})

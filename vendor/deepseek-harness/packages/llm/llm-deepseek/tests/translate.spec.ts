import { describe, expect, it } from 'vitest'
import { BlockAssembler, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { DONE } from '../src/sse.ts'
import { mapFinishReason, mapUsage, translate } from '../src/translate.ts'

async function* feed(...payloads: (string | object)[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

function toolCallId(chunk: StreamChunk | undefined): string | undefined {
  return chunk?.type === 'block-end' && chunk.block.type === 'tool-call' ? chunk.block.id : undefined
}

/** The live first-chunk signature: role + null content + EMPTY reasoning. */
const firstChunk = { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] }

describe('translate: text', () => {
  it('streams a text block and defers finish to DONE', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('assembles into the message BlockAssembler expects', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    ))) {
      assembler.push(chunk)
    }
    const result = { message: assembler.message(), finish: assembler.finish }
    expect(result.message.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(result.finish).toEqual({ kind: 'stop' })
  })
})

describe('translate: reasoning', () => {
  it('does NOT open a reasoning block for the empty first-chunk signature', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'plain' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')).toBe(false)
  })

  it('streams reasoning then text as separate blocks', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: null, reasoning_content: 'think' } }] },
      { choices: [{ delta: { content: null, reasoning_content: 'ing' } }] },
      { choices: [{ delta: { content: 'answer', reasoning_content: null } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'reasoning-delta', index: 0, text: 'ing' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('treats an entirely absent reasoning_content field as non-thinking', async () => {
    const chunks = await collect(translate(feed(
      { choices: [{ delta: { role: 'assistant', content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
    ])
  })
})

describe('translate: tool calls', () => {
  it('reassembles a tool call from fragmented argument deltas (live capture shape)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_x', type: 'function', function: { name: 'get_weather', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ': "Paris"}' } }] } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 28, completion_tokens: 6 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: '{"city"' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: ': "Paris"}' },
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'call_00_x', name: 'get_weather', arguments: '{"city": "Paris"}' },
      },
      { type: 'usage', usage: { inputTokens: 28, outputTokens: 6 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('disambiguates parallel tool calls by wire index', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      {
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } },
              { index: 1, id: 'b', type: 'function', function: { name: 'two', arguments: '' } },
            ],
          },
        }],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const ends = chunks.filter(chunk => chunk.type === 'block-end')
    expect(ends).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'a', name: 'one', arguments: '{}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'b', name: 'two', arguments: '{}' } },
    ])
  })

  it('interleaves text and tool-call blocks with distinct indices', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'Checking.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const starts = chunks.filter(chunk => chunk.type === 'block-start')
    expect(starts).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
    ])
  })
})

describe('translate: finish and usage handling', () => {
  it('takes usage from a trailing usage-only chunk (docs shape)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 1 } },
      DONE,
    )))
    expect(chunks.at(-2)).toEqual({ type: 'usage', usage: { inputTokens: 9, outputTokens: 1 } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('last usage wins when both attached and trailing arrive', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      { choices: [], usage: { prompt_tokens: 2, completion_tokens: 2 } },
      DONE,
    )))
    const usage = chunks.find(chunk => chunk.type === 'usage')
    expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 2 } })
  })

  it('defaults to finish stop when no finish_reason ever arrives', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'x' } }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('omits the usage chunk when none arrived', async () => {
    const chunks = await collect(translate(feed(firstChunk, DONE)))
    expect(chunks.some(chunk => chunk.type === 'usage')).toBe(false)
  })

  it('handles chunks with no choices at all', async () => {
    const chunks = await collect(translate(feed({}, DONE)))
    expect(chunks).toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
      },
    }])
  })

  it('classifies an explicit stop with no opened blocks as EMPTY_RESPONSE, after usage', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 0 } },
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
        },
      },
    ])
  })

  it('keeps a reasoning-only stream a successful stop (any opened block counts)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: null, reasoning_content: 'mull' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('leaves non-stop finishes unclassified even with no opened blocks', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })
})

describe('translate: errors', () => {
  it('throws MALFORMED_RESPONSE for invalid JSON payloads', async () => {
    await expect(collect(translate(feed('{bad json')))).rejects.toThrow(LlmError)
    await expect(collect(translate(feed('{bad json')))).rejects.toThrow(/malformed SSE payload/)
  })

  it('throws STREAM_CLOSED when the payload source ends without DONE', async () => {
    await expect(collect(translate(feed(firstChunk)))).rejects.toThrow(/without \[DONE\]/)
  })
})

describe('mapFinishReason', () => {
  it.each([
    ['stop', { kind: 'stop' }],
    ['tool_calls', { kind: 'tool-calls' }],
    ['length', { kind: 'max-tokens' }],
  ])('maps %s', (wire, expected) => {
    expect(mapFinishReason(wire)).toEqual(expected)
  })

  it.each(['content_filter', 'insufficient_system_resource', 'mystery_reason'])(
    'maps %s to an error kind with the wire code',
    (wire) => {
      expect(mapFinishReason(wire)).toEqual({
        kind: 'error',
        failure: { message: `model stopped: ${wire}`, code: wire.toUpperCase() },
      })
    },
  )
})

describe('mapUsage', () => {
  it('maps the full live-capture shape', () => {
    expect(mapUsage({
      prompt_tokens: 283,
      completion_tokens: 69,
      prompt_cache_hit_tokens: 256,
      prompt_cache_miss_tokens: 27,
      prompt_tokens_details: { cached_tokens: 256 },
      completion_tokens_details: { reasoning_tokens: 24 },
    })).toEqual({
      // 283 wire prompt_tokens minus the 256 cached → 27 uncached input
      // (TokenUsage counts are disjoint).
      inputTokens: 27,
      outputTokens: 69,
      cacheReadTokens: 256,
      reasoningTokens: 24,
    })
  })

  it('falls back to prompt_cache_hit_tokens when details are absent', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 8 }))
      .toEqual({ inputTokens: 2, outputTokens: 2, cacheReadTokens: 8 })
  })

  it('omits optional fields when the wire omits them', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 2 }))
      .toEqual({ inputTokens: 10, outputTokens: 2 })
  })
})

describe('translate: defensive tool-call branches', () => {
  it('assigns a stable id when deltas never carry id or name', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      // Hypothetical lenient wire: argument fragments with no id/name at all.
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: expect.stringMatching(/^dsh-tool-call-/), argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: expect.objectContaining({ type: 'tool-call', name: '', arguments: '{}' }) },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    const delta = chunks.find(chunk => chunk.type === 'tool-call-delta')
    const end = chunks.find(chunk => chunk.type === 'block-end')
    expect(toolCallId(end)).toBe(delta?.type === 'tool-call-delta' ? delta.id : undefined)
  })

  it('keeps parallel missing-id calls distinct and stable when a later id appears', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      {
        choices: [{ delta: {
          tool_calls: [
            { index: 0, function: { arguments: '{"a":1}' } },
            { index: 1, function: { arguments: '{"b":2}' } },
          ],
        } }],
      },
      {
        choices: [{ delta: {
          tool_calls: [
            { index: 0, id: 'provider-id-0', function: { arguments: '' } },
            { index: 1, function: { arguments: '' } },
          ],
        } }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const deltas = chunks.filter(chunk => chunk.type === 'tool-call-delta')
    const ends = chunks.filter(chunk => chunk.type === 'block-end')
    expect(deltas).toHaveLength(4)
    expect(deltas[0]?.type === 'tool-call-delta' && deltas[1]?.type === 'tool-call-delta'
      ? new Set([deltas[0].id, deltas[1].id]).size
      : 0).toBe(2)
    expect(deltas[2]?.type === 'tool-call-delta' && deltas[0]?.type === 'tool-call-delta'
      ? deltas[2].id
      : undefined).toBe(deltas[0]?.type === 'tool-call-delta' ? deltas[0].id : undefined)
    expect(deltas[3]?.type === 'tool-call-delta' && deltas[1]?.type === 'tool-call-delta'
      ? deltas[3].id
      : undefined).toBe(deltas[1]?.type === 'tool-call-delta' ? deltas[1].id : undefined)
    expect(ends).toHaveLength(2)
    expect(ends[0]?.type === 'block-end' ? ends[0].block : undefined).toMatchObject({ type: 'tool-call', name: '', arguments: '{"a":1}' })
    expect(ends[1]?.type === 'block-end' ? ends[1].block : undefined).toMatchObject({ type: 'tool-call', name: '', arguments: '{"b":2}' })
    expect(toolCallId(ends[0])).toBe(deltas[0]?.type === 'tool-call-delta' ? deltas[0].id : undefined)
    expect(toolCallId(ends[1])).toBe(deltas[1]?.type === 'tool-call-delta' ? deltas[1].id : undefined)
  })

  it('handles tool_call deltas with a function object but no arguments field', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'f' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c', name: 'f', argumentsDelta: '' })
  })

  it('handles tool_call deltas with no function object at all', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c', argumentsDelta: '' })
  })
})

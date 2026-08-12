// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseAiEditingResponse } from './response-parser'

describe('parseAiEditingResponse', () => {
  it('accepts the exact JSON tool protocol', () => {
    expect(parseAiEditingResponse(JSON.stringify({
      reply: '读取工程结构',
      toolCalls: [
        { id: 'source.read', args: { path: 'manifest.json' } },
        { id: 'docs.read', args: { path: 'docs/types/project-source-schema.ts' } },
      ],
    }))).toEqual({
      reply: '读取工程结构',
      toolCalls: [
        { id: 'source.read', args: { path: 'manifest.json' } },
        { id: 'docs.read', args: { path: 'docs/types/project-source-schema.ts' } },
      ],
    })
  })

  it('accepts an explicit final response with no tool calls', () => {
    expect(parseAiEditingResponse('{"reply":"最终答复","toolCalls":[]}')).toEqual({
      reply: '最终答复',
      toolCalls: [],
    })
  })

  it.each([
    ['content alias', { content: '最终答复', toolCalls: [] }],
    ['tool_calls alias', { reply: '', tool_calls: [] }],
    ['missing reply', { toolCalls: [] }],
    ['missing toolCalls', { reply: '最终答复' }],
    ['extra top-level field', { reply: '', toolCalls: [], content: '' }],
    ['toolId alias', { reply: '', toolCalls: [{ toolId: 'source.read', args: {} }] }],
    ['encoded arguments', { reply: '', toolCalls: [{ id: 'source.read', args: '{}' }] }],
    ['extra call field', { reply: '', toolCalls: [{ id: 'source.read', args: {}, path: 'x' }] }],
    ['tool-name shorthand', { reply: '', toolCalls: [{ 'source.read': { path: 'x' } }] }],
  ])('rejects %s', (_name, value) => {
    expect(parseAiEditingResponse(JSON.stringify(value))).toBeNull()
  })

  it.each([
    'prefix {"reply":"answer","toolCalls":[]}',
    '```json\n{"reply":"answer","toolCalls":[]}\n```',
    '{"reply":"answer","toolCalls":[]} trailing',
    '{" ":null,"content":"source code"}',
  ])('rejects wrapped or malformed output', (raw) => {
    expect(parseAiEditingResponse(raw)).toBeNull()
  })
})

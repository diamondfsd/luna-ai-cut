// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseAiEditingResponse } from './response-parser'

describe('parseAiEditingResponse', () => {
  it('accepts tool parameters accidentally placed beside the tool id', () => {
    const response = parseAiEditingResponse(JSON.stringify({
      reply: '读取工程结构和类型定义',
      toolCalls: [
        { id: 'source.read', args: { path: 'manifest.json' } },
        { id: 'docs.read', path: 'docs/types/project-source-schema.ts', startLine: 1 },
      ],
    }))

    expect(response).toEqual({
      reply: '读取工程结构和类型定义',
      toolCalls: [
        { id: 'source.read', args: { path: 'manifest.json' } },
        {
          id: 'docs.read',
          args: { path: 'docs/types/project-source-schema.ts', startLine: 1 },
        },
      ],
    })
  })

  it('accepts common native-tool JSON aliases and encoded arguments', () => {
    const response = parseAiEditingResponse(JSON.stringify({
      content: '继续读取',
      tool_calls: [{
        type: 'function',
        function: { name: 'source.read', arguments: '{"path":"sequence.json"}' },
      }],
    }))

    expect(response).toEqual({
      reply: '继续读取',
      toolCalls: [{ id: 'source.read', args: { path: 'sequence.json' } }],
    })
  })

  it('accepts toolId when a model mirrors the tool-result field name', () => {
    const response = parseAiEditingResponse(JSON.stringify({
      toolId: 'skill.read',
      args: { name: '创意决策' },
    }))

    expect(response).toEqual({
      reply: '',
      toolCalls: [{ id: 'skill.read', args: { name: '创意决策' } }],
    })
  })

  it('keeps usable tool calls when the reply key is malformed', () => {
    const response = parseAiEditingResponse(JSON.stringify({
      '"reply":"': '读取工程结构和类型定义',
      toolCalls: [{ id: 'source.read', args: { path: 'sequence.json' } }],
    }))

    expect(response).toEqual({
      reply: '',
      toolCalls: [{ id: 'source.read', args: { path: 'sequence.json' } }],
    })
  })
})

// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseAiEditingResponse } from './response-parser'

describe('parseAiEditingResponse', () => {
  it('accepts a valid response surrounded by conversational text', () => {
    expect(
      parseAiEditingResponse('我已经准备好。\n{"reply":"准备生成计划","toolCalls":[{"id":"project.inspect","args":{}}]}'),
    ).toEqual({
      reply: '准备生成计划',
      toolCalls: [{ id: 'project.inspect', args: {} }],
    })
  })

  it('finds the response after unrelated braces in a model preface', () => {
    expect(
      parseAiEditingResponse('说明 {不是 JSON}。\n{"reply":"查看完成","toolCalls":[]}'),
    ).toEqual({ reply: '查看完成', toolCalls: [] })
  })

  it('rejects objects without the required tool call array', () => {
    expect(parseAiEditingResponse('{"reply":"只是一句说明"}')).toBeNull()
  })
})

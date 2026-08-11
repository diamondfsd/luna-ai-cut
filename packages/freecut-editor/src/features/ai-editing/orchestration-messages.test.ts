// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmMessage } from '@freecut/infrastructure/llm'

vi.mock('./tool-registry', () => ({
  listAiEditingTools: () => [
    {
      id: 'tool.load', title: '加载工具', description: '加载工具定义', risk: 'read',
      inputSchema: { type: 'object' },
    },
    {
      id: 'source.read', title: '读取源码', description: '读取源码文件', risk: 'read',
      inputSchema: { type: 'object' },
    },
  ],
}))

import { buildInitialMessages } from './orchestration-messages'

describe('AI editing message prefix', () => {
  it('replays the exact previous request before appending volatile turn context', async () => {
    const candidates = new Set(['source.read'])
    const first = await buildInitialMessages(
      '先给我一个剪辑方案',
      [],
      { headCommitId: 'first', dirty: false },
      'json',
      candidates,
      new Set(['tool.load']),
    )
    const previousExchange: LlmMessage[] = [
      ...first.slice(1),
      { role: 'assistant', content: '这是一个完整的剪辑方案和分镜安排。' },
    ]
    const second = await buildInitialMessages(
      '好的，按这个方案来',
      previousExchange,
      { headCommitId: 'second', dirty: true },
      'json',
      candidates,
      new Set(['tool.load', 'source.read']),
      true,
    )

    expect(second.slice(0, first.length + 1)).toEqual([
      first[0],
      ...previousExchange,
    ])
    expect(second[0]).toEqual(first[0])
    expect(second.at(-1)?.content).toContain('"headCommitId":"second"')
    expect(second.at(-1)?.content).toContain('source.read')
    expect(second.at(-1)?.content).toContain('用户已确认上一条剪辑方案')
  })
})

// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmMessage } from '@freecut/infrastructure/llm'

vi.mock('./tool-registry', () => ({
  listAiEditingTools: () => [
    {
      id: 'media.list', title: '列出项目素材', description: '读取项目素材摘要', risk: 'read',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
    {
      id: 'source.read', title: '读取源码', description: '读取源码文件', risk: 'read',
      inputSchema: { type: 'object' },
    },
  ],
}))

import { buildInitialMessages } from './orchestration-messages'

describe('AI editing message prefix', () => {
  it('builds project context once and only appends later user turns', async () => {
    const candidates = new Set(['media.list', 'source.read'])
    const first = await buildInitialMessages(
      '先给我一个剪辑方案',
      [],
      { headCommitId: 'first', dirty: false },
      'json',
      candidates,
    )
    const previousTurn: LlmMessage[] = [
      ...first.slice(1),
      { role: 'assistant', content: '这是一个完整的剪辑方案和分镜安排。' },
    ]
    const second = await buildInitialMessages(
      '好的，按这个方案来',
      previousTurn,
      { headCommitId: 'second', dirty: true },
      'json',
      candidates,
    )

    expect(second.slice(0, first.length + 1)).toEqual([
      ...first,
      previousTurn.at(-1),
    ])
    expect(previousTurn.at(-2)).toEqual({ role: 'user', content: '先给我一个剪辑方案' })
    expect(second[0]).toEqual(first[0])
    expect(second[0]?.content).toContain('source.read')
    expect(second[0]?.content).toContain('读取源码文件')
    expect(second[0]?.content).not.toContain('tool.load')
    expect(first[1]).toMatchObject({ role: 'system' })
    expect(first[1]?.content).toContain('"headCommitId":"first"')
    expect(second).toHaveLength(1 + previousTurn.length + 1)
    expect(second.filter((message) => message.role === 'system')).toHaveLength(2)
    expect(second.map((message) => message.content).join('\n')).not.toContain('"headCommitId":"second"')
    expect(second.at(-1)).toEqual({ role: 'user', content: '好的，按这个方案来' })
  })
})

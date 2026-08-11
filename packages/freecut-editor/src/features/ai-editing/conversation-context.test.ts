import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'
import type { AiEditingAgentTurn } from '@freecut/infrastructure/storage'
import { prepareConversationContext } from './conversation-context'

function adapterWithSummary(summary = '压缩后的完整轮次摘要') {
  return {
    id: 'test',
    label: 'Test',
    isSupported: () => true,
    load: async () => undefined,
    generate: vi.fn(async () => summary),
    dispose: () => undefined,
  } satisfies LlmAdapter
}

function turn(id: string, messages?: AiEditingAgentTurn['messages']): AiEditingAgentTurn {
  return {
    id,
    protocol: 'native',
    createdAt: 100,
    messages: messages ?? [
      { role: 'user', content: `请求 ${id}` },
      { role: 'assistant', content: `答复 ${id}` },
    ],
  }
}

describe('prepareConversationContext', () => {
  it('does not compact below the real usage threshold', async () => {
    const adapter = adapterWithSummary()
    const result = await prepareConversationContext(
      [turn('one'), turn('two'), turn('three')],
      null,
      { adapter, contextWindowTokens: 16_384, lastPromptTokens: 13_106 },
    )

    expect(adapter.generate).not.toHaveBeenCalled()
    expect(result.context).toBeNull()
    expect(result.agentHistory).toHaveLength(6)
  })

  it('compacts only complete turns and preserves a recent tool exchange', async () => {
    const adapter = adapterWithSummary()
    const toolTurn = turn('four', [
      { role: 'user', content: '读取并修改源码' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'call-1', name: 'source_read', arguments: '{"path":"main.ts"}' }],
      },
      { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
      { role: 'assistant', content: '修改已完成' },
    ])
    const result = await prepareConversationContext(
      [turn('one'), turn('two'), turn('three'), toolTurn],
      null,
      { adapter, contextWindowTokens: 16_384, lastPromptTokens: 13_107 },
    )

    expect(result.context?.throughMessageId).toBe('two')
    expect(result.agentHistory[0]).toMatchObject({ role: 'system' })
    expect(result.agentHistory.slice(1)).toEqual([
      ...turn('three').messages,
      ...toolTurn.messages,
    ])
    expect(adapter.generate).toHaveBeenCalledOnce()
  })
})

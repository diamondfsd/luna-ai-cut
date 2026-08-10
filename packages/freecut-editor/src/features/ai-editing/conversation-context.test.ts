// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'
import { prepareConversationContext } from './conversation-context'

function conversation(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${offset + index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `content-${offset + index}`,
  }))
}

function adapter(generate = vi.fn().mockResolvedValue('压缩后的连续会话摘要')): LlmAdapter {
  return {
    id: 'test',
    label: 'Test',
    isSupported: () => true,
    load: async () => undefined,
    generate,
    dispose: () => undefined,
  }
}

describe('AI editing conversation context', () => {
  it('appends normal conversations without invoking a compaction request', async () => {
    const generate = vi.fn()
    const result = await prepareConversationContext(conversation(20), null, {
      adapter: adapter(generate),
    })

    expect(generate).not.toHaveBeenCalled()
    expect(result.context).toBeNull()
    expect(result.history).toHaveLength(20)
    expect(result.history.at(-1)?.content).toBe('content-19')
  })

  it('compacts only older completed turns and keeps recent messages verbatim', async () => {
    const generate = vi.fn().mockResolvedValue('目标是完成宝宝 AI Agent 的抖音视频。')
    const result = await prepareConversationContext(conversation(30), null, {
      adapter: adapter(generate),
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.context?.throughMessageId).toBe('message-17')
    expect(result.history[0]?.role).toBe('system')
    expect(result.history[0]?.content).toContain('宝宝 AI Agent')
    expect(result.history.slice(1).map((message) => message.content)).toEqual(
      conversation(12, 18).map((message) => message.content),
    )
  })

  it('continues from the persisted cursor instead of recompressing old messages', async () => {
    const first = await prepareConversationContext(conversation(30), null, {
      adapter: adapter(),
    })
    const generate = vi.fn().mockResolvedValue('更新后的摘要')
    const allMessages = [...conversation(30), ...conversation(14, 30)]
    const second = await prepareConversationContext(allMessages, first.context, {
      adapter: adapter(generate),
    })

    expect(generate).toHaveBeenCalledTimes(1)
    const summaryInput = generate.mock.calls[0]?.[0]?.[1]?.content as string
    expect(summaryInput).toContain('已有摘要')
    expect(summaryInput).not.toContain('content-0')
    expect(second.context?.throughMessageId).toBe('message-31')
    expect(second.history.at(-1)?.content).toBe('content-43')
  })
})

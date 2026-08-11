import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'

const harness = vi.hoisted(() => {
  const session = { promptContext: vi.fn(async () => ({ counts: {}, repository: {} })) }
  return { session, start: vi.fn(async () => session), clear: vi.fn() }
})

vi.mock('./coding-workspace/session-registry', () => ({
  startTimelineCodingSession: harness.start,
  getTimelineCodingSession: () => harness.session,
  clearTimelineCodingSession: harness.clear,
}))

vi.mock('./tool-execution', () => ({
  executeToolCall: vi.fn(async (call: { id: string }) => ({
    toolId: call.id,
    result: { ok: true, message: '完整工程已发布。', data: { ok: true, revisionAfter: 1 } },
  })),
  executeNativeToolCall: vi.fn(),
  serializeForModel: (value: unknown) => JSON.stringify(value),
}))

import { runSingleAiEditingTurn } from './orchestrator'

describe('AI editing publish checkpoint', () => {
  it('stops the model loop as soon as the complete build commits', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          reply: '整片已完成。',
          toolCalls: [{ id: 'timeline.commit', args: { commitId: 'complete-build' } }],
        }),
      )
      .mockRejectedValueOnce(new Error('不应再请求模型'))
    const adapter: LlmAdapter = {
      id: 'test',
      label: 'Test',
      isSupported: () => true,
      load: async () => undefined,
      generate,
      dispose: () => undefined,
    }

    const result = await runSingleAiEditingTurn(
      '完成整片剪辑',
      { history: [], adapter },
      { maxToolRounds: 2 },
    )

    expect(result.completed).toBe(true)
    expect(result.reply).toBe('整片已完成。')
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

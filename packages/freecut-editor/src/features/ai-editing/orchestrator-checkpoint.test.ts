import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'

vi.mock('./tool-execution', () => ({
  executeToolCall: vi.fn(async (call: { id: string }) => ({
    toolId: call.id,
    result: {
      ok: true,
      message: '第一段已提交。',
      data: { committed: true, revisionBefore: 0, revisionAfter: 1 },
    },
  })),
  executeNativeToolCall: vi.fn(),
  serializeForModel: (value: unknown) => JSON.stringify(value),
}))

import { runSingleAiEditingTurn } from './orchestrator'

describe('AI editing checkpoints', () => {
  it('preserves a committed segment when the following model request fails', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        reply: '',
        toolCalls: [{ id: 'workspace.apply_edit_program', args: {} }],
      }))
      .mockRejectedValueOnce(new Error('模型连接中断'))
    const adapter: LlmAdapter = {
      id: 'test',
      label: 'Test',
      isSupported: () => true,
      load: async () => undefined,
      generate,
      dispose: () => undefined,
    }

    const result = await runSingleAiEditingTurn('完成整片剪辑', {
      history: [],
      adapter,
    }, { evidence: {}, maxToolRounds: 2 })

    expect(result.completed).toBe(false)
    expect(result.observations).toHaveLength(1)
    expect(result.timelineRevisionAfter).toBeGreaterThanOrEqual(result.timelineRevisionBefore)
    expect(result.reply).toContain('已保存前面完成的剪辑片段')
    expect(result.completionNotes).toContain('模型连接中断')
  })
})

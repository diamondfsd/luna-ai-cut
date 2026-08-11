import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmMessage } from '@freecut/infrastructure/llm'

vi.mock('./coding-workspace/session-registry', () => ({
  getTimelineCodingSession: () => ({
    promptContext: async () => ({ repository: { branch: 'main' } }),
  }),
}))

import {
  buildInitialMessages,
  buildJsonFallbackMessages,
  isConfirmedPlanExecutionRequest,
} from './orchestration-messages'

const deliveredPlan: LlmMessage[] = [
  { role: 'user', content: '帮我设计一个抖音视频脚本' },
  {
    role: 'assistant',
    content: '脚本方案：开场使用宝宝的语音，随后切换到游戏画面，结尾展示完成效果。',
  },
]

describe('AI editing orchestration messages', () => {
  it.each([
    'OK就按照这个方案吧',
    '可以，就按这个剪',
    '按这个方案执行',
  ])('recognizes confirmed plan execution: %s', (userText) => {
    expect(isConfirmedPlanExecutionRequest(userText, deliveredPlan)).toBe(true)
  })

  it.each([
    '这个方案怎么样？',
    '帮我调整一下方案',
    '按这个方案会不会太长？',
  ])('does not treat discussion as execution: %s', (userText) => {
    expect(isConfirmedPlanExecutionRequest(userText, deliveredPlan)).toBe(false)
  })

  it('requires an assistant-delivered editing plan', () => {
    expect(isConfirmedPlanExecutionRequest('OK就按照这个方案吧', [
      { role: 'assistant', content: '好的，请告诉我你还需要什么。' },
    ])).toBe(false)
  })

  it('adds the execution directive to the initial native prompt', async () => {
    const messages = await buildInitialMessages(
      'OK就按照这个方案吧',
      deliveredPlan,
      { repository: { branch: 'main' } },
      'native',
    )

    expect(messages[0]?.content).toContain('本轮是实际修改项目的执行请求')
    expect(messages[0]?.content).toContain('timeline.commit')
  })

  it('preserves the execution directive in JSON fallback messages', async () => {
    const messages = await buildJsonFallbackMessages(
      'OK就按照这个方案吧',
      deliveredPlan,
      [],
      { history: deliveredPlan },
    )

    expect(messages[0]?.content).toContain('本轮是实际修改项目的执行请求')
    expect(messages[0]?.content).toContain('timeline.commit')
  })
})

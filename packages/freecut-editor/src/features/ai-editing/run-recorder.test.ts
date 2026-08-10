// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))

vi.mock('@freecut/infrastructure/storage', () => ({
  saveAiEditingRun: mocks.save,
}))

vi.mock('./conversation-writes', () => ({
  enqueueAiEditingConversationWrite: async (_projectId: string, operation: () => Promise<void>) =>
    operation(),
}))

import { createAiEditingRunRecorder } from './run-recorder'

describe('AI editing run recorder', () => {
  beforeEach(() => mocks.save.mockReset().mockResolvedValue(undefined))

  it('persists a running record before model execution and keeps full round evidence', async () => {
    const recorder = createAiEditingRunRecorder({
      id: 'message-1',
      projectId: 'project-1',
      request: '按脚本剪辑',
      timelineRevisionBefore: 4,
    })

    await recorder.start()
    recorder.trace({
      type: 'model-response',
      message: '模型返回第 1 轮结果。',
      data: { raw: '{"toolCalls":[{"id":"analysis.request"}]}' },
    })
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))

    const firstRecord = mocks.save.mock.calls[0]?.[1]
    const latestRecord = mocks.save.mock.calls[1]?.[1]
    expect(firstRecord).toMatchObject({ id: 'message-1', status: 'running', phase: 'queued' })
    expect(latestRecord).toMatchObject({ status: 'running', phase: 'model-response' })
    expect(JSON.stringify(latestRecord.events)).toContain('analysis.request')
  })

  it('updates the same record with terminal status and tool results', async () => {
    const recorder = createAiEditingRunRecorder({
      id: 'message-2',
      projectId: 'project-1',
      request: '剪第一个 shot',
      timelineRevisionBefore: 0,
    })
    await recorder.start()
    await recorder.complete({
      reply: '第一个 shot 已完成。',
      observations: [{
        toolId: 'workspace.apply_edit_program',
        result: { ok: true, message: '已提交', data: { committed: true } },
      }],
      plan: [],
      completed: true,
      completionNotes: [],
      timelineRevisionBefore: 0,
      timelineRevisionAfter: 3,
    })

    const latestRecord = mocks.save.mock.calls.at(-1)?.[1]
    expect(latestRecord).toMatchObject({
      id: 'message-2',
      status: 'completed',
      completed: true,
      timelineRevisionAfter: 3,
      toolCalls: [{ id: 'workspace.apply_edit_program', ok: true }],
    })
  })

  it('keeps every diagnostic event in a long-running edit', async () => {
    const recorder = createAiEditingRunRecorder({
      id: 'message-3',
      projectId: 'project-1',
      request: '逐个 shot 完成剪辑',
      timelineRevisionBefore: 0,
    })
    await recorder.start()

    for (let round = 1; round <= 140; round += 1) {
      recorder.trace({
        type: 'model-response',
        message: `模型返回第 ${round} 轮结果。`,
        data: { round, raw: `response-${round}` },
      })
    }

    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(141))
    const latestRecord = mocks.save.mock.calls.at(-1)?.[1]
    expect(latestRecord.events).toHaveLength(141)
    expect(JSON.stringify(latestRecord.events)).toContain('response-1')
    expect(JSON.stringify(latestRecord.events)).toContain('response-140')
  })
})

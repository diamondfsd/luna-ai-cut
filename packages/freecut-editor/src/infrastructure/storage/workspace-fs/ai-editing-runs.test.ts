// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const state = vi.hoisted(() => ({ file: null as unknown }))

vi.mock('./fs-primitives', () => ({
  readJson: vi.fn(async () => state.file),
  writeJsonAtomic: vi.fn(async (_root: unknown, _path: unknown, value: unknown) => {
    state.file = value
  }),
}))

vi.mock('./root', () => ({ requireWorkspaceRoot: () => ({}) }))

import { saveAiEditingRun, type AiEditingRunRecord } from './ai-editing-runs'

function record(overrides: Partial<AiEditingRunRecord> = {}): AiEditingRunRecord {
  return {
    id: 'run-1',
    createdAt: 1,
    request: '剪辑第一个 shot',
    plan: [],
    timelineRevisionBefore: 0,
    timelineRevisionAfter: 0,
    toolCalls: [],
    completed: false,
    completionNotes: [],
    ...overrides,
  }
}

describe('AI editing run storage', () => {
  beforeEach(() => { state.file = null })

  it('updates one durable run record throughout its lifecycle', async () => {
    await saveAiEditingRun('project-1', record({
      status: 'running',
      phase: 'model-request',
      events: [{ at: 2, type: 'model-request', message: '请求第一轮模型。' }],
    }))
    await saveAiEditingRun('project-1', record({
      status: 'completed',
      phase: 'completed',
      completed: true,
      timelineRevisionAfter: 3,
      toolCalls: [{ id: 'workspace.apply_edit_program', ok: true, message: '已提交' }],
      events: [
        { at: 2, type: 'model-request', message: '请求第一轮模型。' },
        { at: 3, type: 'completed', message: '第一个 shot 已完成。' },
      ],
    }))

    const file = state.file as { runs: AiEditingRunRecord[] }
    expect(file.runs).toHaveLength(1)
    expect(file.runs[0]).toMatchObject({
      id: 'run-1',
      status: 'completed',
      timelineRevisionAfter: 3,
    })
    expect(file.runs[0]?.events).toHaveLength(2)
  })

  it('does not truncate early diagnostic events', async () => {
    const events = Array.from({ length: 140 }, (_, index) => ({
      at: index + 1,
      type: 'model-response',
      message: `模型返回第 ${index + 1} 轮结果。`,
      data: { raw: `response-${index + 1}` },
    }))

    await saveAiEditingRun('project-1', record({ events }))

    const file = state.file as { runs: AiEditingRunRecord[] }
    expect(file.runs[0]?.events).toEqual(events)
  })
})

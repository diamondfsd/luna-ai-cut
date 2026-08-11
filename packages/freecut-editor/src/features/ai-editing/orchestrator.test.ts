import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'

const harness = vi.hoisted(() => {
  const session = {
    promptContext: vi.fn(async () => ({
      kind: 'luna-editing-source-repository',
      counts: { media: 12, tracks: 3, clips: 240, transitions: 8 },
      repository: { branch: 'main', entrypoint: 'manifest.json', dirty: false },
    })),
  }
  return {
    session,
    start: vi.fn(async () => session),
    clear: vi.fn(),
  }
})

vi.mock('./coding-workspace/session-registry', () => ({
  startTimelineCodingSession: harness.start,
  getTimelineCodingSession: () => harness.session,
  clearTimelineCodingSession: harness.clear,
}))

vi.mock('./tool-execution', () => ({
  executeToolCall: vi.fn(async (call: { id: string }) => ({
    toolId: call.id,
    result:
      call.id === 'timeline.commit'
        ? { ok: true, message: '已发布。', data: { ok: true, revisionAfter: 2 } }
        : call.id === 'workspace.patch'
          ? { ok: true, message: '已修改。', data: { changed: true } }
          : { ok: true, message: '操作完成。' },
  })),
  executeNativeToolCall: vi.fn(),
  serializeForModel: (value: unknown) => JSON.stringify(value),
}))

import { runSingleAiEditingTurn } from './orchestrator'

function adapter(response: string): LlmAdapter {
  return {
    id: 'test',
    label: 'Test',
    isSupported: () => true,
    load: async () => undefined,
    generate: vi.fn().mockResolvedValue(response),
    dispose: () => undefined,
  }
}

function jsonResponse(reply: string, toolCalls: unknown[]): string {
  return JSON.stringify({ reply, toolCalls })
}

describe('AI editing coding-agent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes a text-only request without a finish tool', async () => {
    const result = await runSingleAiEditingTurn(
      '只设计脚本',
      { history: [], adapter: adapter(jsonResponse('这是脚本正文。', [])) },
      { maxToolRounds: 1 },
    )

    expect(result.completed).toBe(true)
    expect(result.reply).toBe('这是脚本正文。')
    expect(result.observations).toEqual([])
  })

  it('does not treat an empty response as completion', async () => {
    const result = await runSingleAiEditingTurn(
      '继续处理',
      { history: [], adapter: adapter(jsonResponse('', [])) },
      { maxToolRounds: 1 },
    )

    expect(result.completed).toBe(false)
    expect(result.completionNotes).toContain('本轮没有在操作上限内完成用户目标。')
  })

  it('completes editing immediately after a successful timeline commit', async () => {
    const result = await runSingleAiEditingTurn(
      '执行剪辑',
      {
        history: [],
        adapter: adapter(
          jsonResponse('剪辑已完成。', [
            { id: 'timeline.commit', args: { commitId: 'source-commit' } },
          ]),
        ),
      },
      { maxToolRounds: 1 },
    )

    expect(result.completed).toBe(true)
    expect(result.reply).toBe('剪辑已完成。')
    expect(result.observations[0]?.toolId).toBe('timeline.commit')
  })

  it('does not accept final prose while authored source remains unpublished', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse('', [{ id: 'workspace.patch', args: { operations: [] } }]),
      )
      .mockResolvedValueOnce(jsonResponse('已经完成。', []))
    const editingAdapter = adapter('')
    editingAdapter.generate = generate

    const result = await runSingleAiEditingTurn(
      '执行剪辑',
      { history: [], adapter: editingAdapter },
      { maxToolRounds: 2 },
    )

    expect(result.completed).toBe(false)
    expect(result.completionNotes).toContain('剪辑源码尚未成功发布到时间轴。')
  })

  it('starts with repository statistics instead of a complete timeline payload', async () => {
    const generate = vi.fn().mockResolvedValue(jsonResponse('仓库已了解。', []))
    const editingAdapter = adapter('')
    editingAdapter.generate = generate

    await runSingleAiEditingTurn('查看项目', { history: [], adapter: editingAdapter })

    const firstMessages = generate.mock.calls[0]?.[0]
    const systemPrompt = String(firstMessages?.[0]?.content)
    expect(systemPrompt).toContain('"clips":240')
    expect(systemPrompt).not.toContain('selectedClipRefs')
    expect(systemPrompt).not.toContain('"media":[')
  })

  it('clears the coding session after every turn', async () => {
    await runSingleAiEditingTurn('只回答', {
      history: [],
      adapter: adapter(jsonResponse('回答。', [])),
    })

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(harness.clear).toHaveBeenCalledWith(harness.session)
  })
})

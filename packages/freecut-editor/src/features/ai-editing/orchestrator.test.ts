import { describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'
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

describe('AI editing orchestration', () => {
  it('completes a text-only request through an explicit terminal outcome', async () => {
    const result = await runSingleAiEditingTurn('只设计脚本', {
      history: [],
      adapter: adapter(jsonResponse('这是脚本正文。', [{
        id: 'workflow.finish',
        args: { outcome: 'responded', summary: '脚本已设计。' },
      }])),
    }, { evidence: {}, maxToolRounds: 1 })

    expect(result.completed).toBe(true)
    expect(result.reply).toBe('这是脚本正文。')
  })

  it('does not treat an empty tool list as proven completion', async () => {
    const result = await runSingleAiEditingTurn('执行剪辑', {
      history: [],
      adapter: adapter(jsonResponse('已经完成。', [])),
    }, { evidence: {}, maxToolRounds: 1 })

    expect(result.completed).toBe(false)
    expect(result.reply).toContain('尚未完成')
  })

  it('rejects edited completion without a committed edit', async () => {
    const result = await runSingleAiEditingTurn('执行剪辑', {
      history: [],
      adapter: adapter(jsonResponse('已经完成。', [{
        id: 'workflow.finish',
        args: { outcome: 'edited', summary: '剪辑完成。' },
      }])),
    }, { evidence: {}, maxToolRounds: 1 })

    expect(result.completed).toBe(false)
    expect(result.observations[0]?.result.ok).toBe(false)
  })

  it('defers a second edit program returned in the same model response', async () => {
    const invalidEdit = { id: 'workspace.apply_edit_program', args: {} }
    const result = await runSingleAiEditingTurn('执行剪辑', {
      history: [],
      adapter: adapter(jsonResponse('', [invalidEdit, invalidEdit])),
    }, { evidence: {}, maxToolRounds: 1 })

    expect(result.observations).toHaveLength(2)
    expect(result.observations[1]?.result.message).toContain('同一轮只能提交一份')
  })

  it('replaces stale workspace evidence instead of accumulating full snapshots', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(jsonResponse('', [{ id: 'workspace.apply_edit_program', args: {} }]))
      .mockResolvedValueOnce(jsonResponse('', [{
        id: 'workflow.finish',
        args: { outcome: 'blocked', summary: '当前无法继续。' },
      }]))
    const editingAdapter = adapter('')
    editingAdapter.generate = generate

    await runSingleAiEditingTurn('执行剪辑', {
      history: [],
      adapter: editingAdapter,
    }, { evidence: { staleMarker: 'initial-snapshot' }, maxToolRounds: 2 })

    const secondRequestMessages = generate.mock.calls[1]?.[0]
    expect(JSON.stringify(secondRequestMessages)).not.toContain('initial-snapshot')
  })
})

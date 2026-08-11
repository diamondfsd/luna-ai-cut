// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { defaultReply, hasCommittedEdit, hasUnpublishedSourceWork } from './orchestration-results'
import type { AiEditingObservation } from './types'

const committedEdit: AiEditingObservation = {
  toolId: 'timeline.commit',
  result: { ok: true, message: '已发布', data: { ok: true, revisionAfter: 2 } },
}

describe('AI editing coding-agent results', () => {
  it('recognizes only a successful timeline commit as an editing completion', () => {
    expect(hasCommittedEdit([committedEdit])).toBe(true)
    expect(
      hasCommittedEdit([{ toolId: 'git.commit', result: { ok: true, message: '源码已提交' } }]),
    ).toBe(false)
  })

  it('tracks source patches until the build is published', () => {
    const patch: AiEditingObservation = {
      toolId: 'workspace.patch',
      result: { ok: true, message: '已修改', data: { changed: true } },
    }
    expect(hasUnpublishedSourceWork([patch])).toBe(true)
    expect(hasUnpublishedSourceWork([patch, committedEdit])).toBe(false)
  })

  it('reports source-only work separately from a published timeline', () => {
    expect(
      defaultReply([
        {
          toolId: 'git.commit',
          result: { ok: true, message: '已提交', data: { created: true } },
        },
      ]),
    ).toContain('尚未发布')
    expect(defaultReply([committedEdit])).toContain('已构建并发布')
  })
})

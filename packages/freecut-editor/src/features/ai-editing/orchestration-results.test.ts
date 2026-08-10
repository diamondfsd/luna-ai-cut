// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  hasCommittedEdit,
  terminalState,
  validateFinishObservation,
} from './orchestration-results'
import type { AiEditingObservation } from './types'

function finish(outcome: 'responded' | 'edited' | 'blocked'): AiEditingObservation {
  return {
    toolId: 'workflow.finish',
    result: { ok: true, message: '完成说明', data: { outcome, summary: '完成说明' } },
  }
}

const committedEdit: AiEditingObservation = {
  toolId: 'workspace.apply_edit_program',
  result: { ok: true, message: '已提交', data: { committed: true, revisionAfter: 2 } },
}

describe('AI editing terminal state', () => {
  it('accepts a text-only response without requiring an edit', () => {
    expect(terminalState([finish('responded')])).toMatchObject({ finished: true, completed: true })
  })

  it('rejects edited completion until an edit has committed', () => {
    const observation = validateFinishObservation(finish('edited'), [])
    expect(observation.result.ok).toBe(false)
    expect(terminalState([observation]).finished).toBe(false)
  })

  it('accepts edited completion after a committed checkpoint', () => {
    expect(hasCommittedEdit([committedEdit])).toBe(true)
    const observation = validateFinishObservation(finish('edited'), [committedEdit])
    expect(terminalState([committedEdit, observation])).toMatchObject({
      finished: true,
      completed: true,
    })
  })

  it('treats blocked as terminal but incomplete', () => {
    expect(terminalState([finish('blocked')])).toMatchObject({ finished: true, completed: false })
  })
})

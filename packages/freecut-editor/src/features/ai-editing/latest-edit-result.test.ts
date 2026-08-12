import { describe, expect, it } from 'vite-plus/test'
import { latestFailedEdit } from './latest-edit-result'
import type { AiEditingObservation } from './types'

describe('latestFailedEdit', () => {
  it('reports a failed source mutation when no edit was committed', () => {
    const failedRemove: AiEditingObservation = {
      toolId: 'source.remove',
      result: { ok: false, message: 'SOURCE_REVISION_MISMATCH' },
    }

    expect(latestFailedEdit([failedRemove, {
      toolId: 'source.read',
      result: { ok: true, message: 'read' },
    }])).toBe(failedRemove)
  })

  it('does not let an earlier recovered failure override a successful commit', () => {
    expect(latestFailedEdit([{
      toolId: 'source.remove',
      result: { ok: false, message: 'SOURCE_REVISION_MISMATCH' },
    }, {
      toolId: 'git.commit',
      result: { ok: true, message: 'saved', data: { created: true } },
    }])).toBeUndefined()
  })
})

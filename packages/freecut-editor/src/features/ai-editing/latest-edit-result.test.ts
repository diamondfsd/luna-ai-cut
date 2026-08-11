// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { latestFailedEdit } from './latest-edit-result'
import type { AiEditingObservation } from './types'

function editResult(ok: boolean, message: string): AiEditingObservation {
  return {
    toolId: 'timeline.commit',
    result: { ok, message, ...(ok ? { data: { ok: true } } : {}) },
  }
}

describe('latest edit result', () => {
  it('treats a successful retry as the final edit outcome', () => {
    expect(
      latestFailedEdit([editResult(false, '版本已经变化'), editResult(true, '重试已应用')]),
    ).toBeUndefined()
  })

  it('returns the failure when the latest edit attempt fails', () => {
    expect(
      latestFailedEdit([editResult(true, '首次已应用'), editResult(false, '后续修正失败')])?.result
        .message,
    ).toBe('后续修正失败')
  })
})

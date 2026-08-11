// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { failedEditMessage, latestFailedEdit } from './latest-edit-result'
import type { AiEditingObservation } from './types'

function editResult(
  ok: boolean,
  message: string,
  toolId: 'timeline.commit' | 'timeline.publish_stage' = 'timeline.commit',
): AiEditingObservation {
  return {
    toolId,
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

  it('includes stage publications when selecting the latest edit outcome', () => {
    expect(
      latestFailedEdit([
        editResult(true, '最终提交成功'),
        editResult(false, '阶段发布失败', 'timeline.publish_stage'),
      ])?.result.message,
    ).toBe('阶段发布失败')
  })

  it('reports a build failure that occurs after a successful stage publication', () => {
    const buildFailure: AiEditingObservation = {
      toolId: 'timeline.build',
      result: {
        ok: false,
        message: '命令发现需要修正的源码。',
        data: {
          diagnostics: [{
            code: 'BUILD_FAILED',
            severity: 'error',
            message: '时间轴在生成编辑程序后已发生变化，请基于最新编辑空间重新生成。',
          }],
        },
      },
    }
    const failed = latestFailedEdit([
      editResult(true, '当前阶段已发布', 'timeline.publish_stage'),
      buildFailure,
    ])

    expect(failed).toBe(buildFailure)
    expect(failedEditMessage(failed!)).toBe(
      '时间轴在生成编辑程序后已发生变化，请基于最新编辑空间重新生成。',
    )
  })
})

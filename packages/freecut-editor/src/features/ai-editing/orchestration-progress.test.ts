// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { LlmRequestStatus } from '@freecut/infrastructure/llm'
import type { AiEditingRunOptions } from './run-types'
import { reportModelRequestStatus } from './orchestration-progress'

function reportedLabel(status: LlmRequestStatus): string | undefined {
  let label: string | undefined
  const options: AiEditingRunOptions = {
    history: [],
    onRunProgress: (progress) => {
      label = progress.label
    },
  }
  reportModelRequestStatus(options, status, 20)
  return label
}

describe('AI editing model request progress', () => {
  it('does not show an attempt count during the first request', () => {
    expect(
      reportedLabel({
        attempt: 1,
        maxAttempts: 3,
        state: 'waiting',
      }),
    ).toBe('正在等待剪辑方案')

    expect(
      reportedLabel({
        attempt: 1,
        maxAttempts: 3,
        state: 'streaming',
        previewKind: 'reasoning',
      }),
    ).toBe('正在整理剪辑思路')
  })

  it('shows the attempt count once a retry is in progress', () => {
    expect(
      reportedLabel({
        attempt: 2,
        maxAttempts: 3,
        state: 'retrying',
      }),
    ).toBe('正在重新尝试获取剪辑方案（第 2/3 次）')

    expect(
      reportedLabel({
        attempt: 2,
        maxAttempts: 3,
        state: 'streaming',
        previewKind: 'content',
      }),
    ).toBe('正在生成剪辑方案（第 2/3 次）')
  })
})

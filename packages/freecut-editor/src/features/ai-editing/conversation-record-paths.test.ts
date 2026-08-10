// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { formatAiEditingRecordPaths, getAiEditingRecordPaths } from './conversation-record-paths'

describe('AI editing record paths', () => {
  it('uses workspace-relative paths when the browser does not expose a local folder path', () => {
    expect(getAiEditingRecordPaths('project-42', null)).toEqual({
      conversation: 'projects/project-42/ai-editing-conversation.json',
      runs: 'projects/project-42/ai-editing-runs.json',
    })
  })

  it('uses the platform separator for an Electron-managed workspace', () => {
    expect(getAiEditingRecordPaths('project-42', 'C:\\Users\\Luna\\workspace')).toEqual({
      conversation:
        'C:\\Users\\Luna\\workspace\\projects\\project-42\\ai-editing-conversation.json',
      runs: 'C:\\Users\\Luna\\workspace\\projects\\project-42\\ai-editing-runs.json',
    })
  })

  it('formats both files as a diagnostic handoff', () => {
    expect(
      formatAiEditingRecordPaths({
        conversation: '/workspace/projects/project-42/ai-editing-conversation.json',
        runs: '/workspace/projects/project-42/ai-editing-runs.json',
      }),
    ).toBe(
      [
        '对话记录：/workspace/projects/project-42/ai-editing-conversation.json',
        '执行记录：/workspace/projects/project-42/ai-editing-runs.json',
      ].join('\n'),
    )
  })
})

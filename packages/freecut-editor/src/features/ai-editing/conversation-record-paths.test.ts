// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { formatAiEditingRecordPaths, getAiEditingRecordPaths } from './conversation-record-paths'

describe('AI editing record paths', () => {
  it('uses workspace-relative paths when the browser does not expose a local folder path', () => {
    expect(getAiEditingRecordPaths('project-42', null)).toEqual({
      conversation: 'projects/project-42/ai-editing-conversation.json',
      history: 'projects/project-42/ai-editing-conversation-history.json',
      runs: 'projects/project-42/ai-editing-runs.json',
    })
  })

  it('uses the platform separator for an Electron-managed workspace', () => {
    expect(getAiEditingRecordPaths('project-42', 'C:\\Users\\Luna\\workspace')).toEqual({
      conversation:
        'C:\\Users\\Luna\\workspace\\projects\\project-42\\ai-editing-conversation.json',
      history:
        'C:\\Users\\Luna\\workspace\\projects\\project-42\\ai-editing-conversation-history.json',
      runs: 'C:\\Users\\Luna\\workspace\\projects\\project-42\\ai-editing-runs.json',
    })
  })

  it('formats both files as a diagnostic handoff', () => {
    expect(
      formatAiEditingRecordPaths({
        conversation: '/workspace/projects/project-42/ai-editing-conversation.json',
        history: '/workspace/projects/project-42/ai-editing-conversation-history.json',
        runs: '/workspace/projects/project-42/ai-editing-runs.json',
      }),
    ).toBe(
      [
        '当前对话：/workspace/projects/project-42/ai-editing-conversation.json',
        '历史会话：/workspace/projects/project-42/ai-editing-conversation-history.json',
        '执行记录：/workspace/projects/project-42/ai-editing-runs.json',
      ].join('\n'),
    )
  })
})
